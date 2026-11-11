package payments

import (
	"context"
	"math"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/outbox"
)

// ComputeCommission calculates commissionable base and exact minor-unit commission for all 3 configurable bases.
func ComputeCommission(basis string, itemSubtotalMinor, discountMinor, packagingFeeMinor int64, commissionBps int) (commissionableBase int64, commissionMinor int64) {
	switch basis {
	case "NET_AFTER_OUTLET_DISCOUNT":
		commissionableBase = itemSubtotalMinor - discountMinor
		if commissionableBase < 0 {
			commissionableBase = 0
		}
	case "SUBTOTAL_PLUS_PACKAGING":
		commissionableBase = itemSubtotalMinor + packagingFeeMinor
	default: // GROSS_FOOD_SUBTOTAL
		commissionableBase = itemSubtotalMinor
	}
	commissionMinor = int64(math.Round(float64(commissionableBase*int64(commissionBps)) / 10000.0))
	return commissionableBase, commissionMinor
}

// ComputePartnerDistanceEarning computes base + per-km distance pay + tip in minor units.
func ComputePartnerDistanceEarning(basePayoutMinor, perKmMinor int64, distanceMeters int, tipMinor, dailyPayoutFeeMinor int64) (distancePay, gross, net int64) {
	distancePay = int64(math.Round((float64(distanceMeters) / 1000.0) * float64(perKmMinor)))
	gross = basePayoutMinor + distancePay + tipMinor
	net = gross - dailyPayoutFeeMinor
	if net < 0 {
		net = 0
	}
	return distancePay, gross, net
}

// AccrueDeliveryFinancials records immutable restaurant settlement, delivery partner earnings,
// and double-entry financial_ledger_entries inside an active PostgreSQL transaction.
func AccrueDeliveryFinancials(ctx context.Context, tx pgx.Tx, orderID, deliveryID, partnerID string) error {
	var restID, ownerID, currency, commBasis string
	var subtotal, packaging, discount, tax, tip int64
	var commBps, distanceMeters int
	var zoneID string

	err := tx.QueryRow(ctx, `
		SELECT o.restaurant_id, r.owner_user_id, o.service_zone_id, o.currency,
		       o.item_subtotal_minor, o.packaging_fee_minor, o.discount_amount_minor,
		       o.tax_amount_minor, o.tip_amount_minor, o.road_distance_meters,
		       o.commission_rate_bps_snapshot, o.commission_basis_snapshot
		FROM orders o
		JOIN restaurants r ON r.id = o.restaurant_id
		WHERE o.id = $1
	`, orderID).Scan(
		&restID, &ownerID, &zoneID, &currency,
		&subtotal, &packaging, &discount, &tax, &tip, &distanceMeters,
		&commBps, &commBasis,
	)
	if err != nil {
		return err
	}

	commBase, commMinor := ComputeCommission(commBasis, subtotal, discount, packaging, commBps)
	netPayout := subtotal + packaging - commMinor
	if netPayout < 0 {
		netPayout = 0
	}

	settleID := uuid.NewString()
	tag, err := tx.Exec(ctx, `
		INSERT INTO restaurant_settlements (
			id, order_id, restaurant_id, owner_user_id,
			gross_food_amount_minor, packaging_fee_minor, restaurant_promo_discount_minor,
			commission_calculation_basis_snapshot, commissionable_base_amount_minor,
			platform_commission_bps, platform_commission_minor, tax_withheld_minor, net_payout_minor,
			settlement_status
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'ACCRUED')
		ON CONFLICT (order_id) DO NOTHING
	`, settleID, orderID, restID, ownerID, subtotal, packaging, discount, commBasis, commBase, commBps, commMinor, tax, netPayout)
	if err != nil {
		return err
	}

	if tag.RowsAffected() > 0 && netPayout > 0 {
		if _, err := tx.Exec(ctx, `
			INSERT INTO financial_ledger_entries (id, order_id, reference_type, reference_id, debit_account, credit_account, amount_minor, currency)
			VALUES ($1, $2, 'SETTLEMENT_ACCRUAL', $3, 'PLATFORM_ESCROW', 'OUTLET_PAYABLE', $4, $5)
		`, uuid.NewString(), orderID, settleID, netPayout, currency); err != nil {
			return err
		}
	}

	if deliveryID != "" && partnerID != "" {
		basePay := int64(3500)
		perKm := int64(1000)
		_ = tx.QueryRow(ctx, `
			SELECT partner_base_payout_minor, partner_per_km_payout_minor
			FROM delivery_charge_rules
			WHERE is_active = TRUE AND (service_zone_id = $1::uuid OR service_zone_id IS NULL)
			ORDER BY service_zone_id NULLS LAST LIMIT 1
		`, zoneID).Scan(&basePay, &perKm)

		distPay, grossEarn, netEarn := ComputePartnerDistanceEarning(basePay, perKm, distanceMeters, tip, 0)
		earnID := uuid.NewString()
		eTag, err := tx.Exec(ctx, `
			INSERT INTO delivery_partner_earnings (
				id, delivery_id, order_id, partner_id,
				base_payout_minor, per_km_rate_snapshot_minor, distance_meters_snapshot, distance_payout_minor,
				tip_amount_minor, gross_earning_minor, daily_payout_fee_minor, net_earning_minor, status
			)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 0, $11, 'CREDITED')
			ON CONFLICT (delivery_id) DO NOTHING
		`, earnID, deliveryID, orderID, partnerID, basePay, perKm, distanceMeters, distPay, tip, grossEarn, netEarn)
		if err != nil {
			return err
		}
		if eTag.RowsAffected() > 0 && netEarn > 0 {
			if _, err := tx.Exec(ctx, `
				INSERT INTO financial_ledger_entries (id, order_id, reference_type, reference_id, debit_account, credit_account, amount_minor, currency)
				VALUES ($1, $2, 'PARTNER_EARNING', $3, 'PLATFORM_ESCROW', 'PARTNER_WALLET', $4, $5)
			`, uuid.NewString(), orderID, earnID, netEarn, currency); err != nil {
				return err
			}
		}
	}

	return outbox.WriteEvent(ctx, tx, "PAYMENT", orderID, "settlement.accrued", map[string]any{
		"order_id":                  orderID,
		"platform_commission_minor": commMinor,
		"net_payout_minor":          netPayout,
	})
}

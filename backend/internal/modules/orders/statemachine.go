package orders

import "errors"

var (
	ErrInvalidTransition = errors.New("invalid order state transition")
)

var allowedOrderTransitions = map[string]map[string]bool{
	"PENDING_PAYMENT": {
		"CONFIRMED": true,
		"CANCELLED": true,
	},
	"CONFIRMED": {
		"RESTAURANT_ACCEPTED":    true,
		"RESTAURANT_REJECTED":    true,
		"CANCELLATION_REQUESTED": true,
		"CANCELLED":              true,
	},
	"RESTAURANT_ACCEPTED": {
		"PREPARING":              true,
		"CANCELLATION_REQUESTED": true,
		"CANCELLED":              true,
	},
	"PREPARING": {
		"READY_FOR_PICKUP":       true,
		"CANCELLATION_REQUESTED": true,
	},
	"READY_FOR_PICKUP": {
		"OUT_FOR_DELIVERY": true,
	},
	"OUT_FOR_DELIVERY": {
		"DELIVERED": true,
	},
	"CANCELLATION_REQUESTED": {
		"CANCELLED": true,
	},
	"RESTAURANT_REJECTED": {
		"CANCELLED": true,
	},
}

// CanTransitionOrderStatus validates whether transitioning from -> to is permitted.
func CanTransitionOrderStatus(from, to string) bool {
	targets, ok := allowedOrderTransitions[from]
	if !ok {
		return false
	}
	return targets[to]
}

// ValidateTransition returns ErrInvalidTransition when a transition violates the state machine.
func ValidateTransition(from, to string) error {
	if !CanTransitionOrderStatus(from, to) {
		return ErrInvalidTransition
	}
	return nil
}

// CanCustomerSelfCancel checks whether customer self-cancellation is allowed in the current state.
func CanCustomerSelfCancel(status string) bool {
	return status == "PENDING_PAYMENT" || status == "CONFIRMED" || status == "RESTAURANT_ACCEPTED"
}

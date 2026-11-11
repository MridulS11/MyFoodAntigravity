package orders

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestOrderStateMachineMatrix(t *testing.T) {
	// Valid transitions
	assert.NoError(t, ValidateTransition("PENDING_PAYMENT", "CONFIRMED"))
	assert.NoError(t, ValidateTransition("CONFIRMED", "RESTAURANT_ACCEPTED"))
	assert.NoError(t, ValidateTransition("RESTAURANT_ACCEPTED", "PREPARING"))
	assert.NoError(t, ValidateTransition("PREPARING", "READY_FOR_PICKUP"))
	assert.NoError(t, ValidateTransition("READY_FOR_PICKUP", "OUT_FOR_DELIVERY"))
	assert.NoError(t, ValidateTransition("OUT_FOR_DELIVERY", "DELIVERED"))

	// Invalid transitions must fail strictly
	assert.ErrorIs(t, ValidateTransition("PENDING_PAYMENT", "DELIVERED"), ErrInvalidTransition)
	assert.ErrorIs(t, ValidateTransition("CONFIRMED", "READY_FOR_PICKUP"), ErrInvalidTransition)
	assert.ErrorIs(t, ValidateTransition("DELIVERED", "CANCELLED"), ErrInvalidTransition)
	assert.ErrorIs(t, ValidateTransition("CANCELLED", "CONFIRMED"), ErrInvalidTransition)

	// Cancellation policy guard
	assert.True(t, CanCustomerSelfCancel("CONFIRMED"))
	assert.True(t, CanCustomerSelfCancel("RESTAURANT_ACCEPTED"))
	assert.False(t, CanCustomerSelfCancel("PREPARING"))
	assert.False(t, CanCustomerSelfCancel("DELIVERED"))
}

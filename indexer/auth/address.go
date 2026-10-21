package auth

import (
	"errors"
	"fmt"

	"github.com/stellar/go-stellar-sdk/strkey"
)

// Invalid-address sentinels let callers distinguish malformed input from a
// well-formed StrKey carrying the wrong version without exposing the
// underlying decoder error to clients.
var (
	ErrAddressEmpty        = errors.New("address is empty")
	ErrAddressMalformed    = errors.New("address is malformed")
	ErrAddressWrongVersion = errors.New("address has the wrong StrKey version")
)

// ValidateAccountAddress verifies that address is a StrKey-encoded Stellar
// account ID (G...). It rejects seeds (S...), muxed accounts (M...), contracts
// (C...) and any malformed or checksum-invalid StrKey.
func ValidateAccountAddress(address string) error {
	return validateAddress(address, strkey.VersionByteAccountID, "account address (G...)")
}

// ValidateContractAddress verifies that address is a StrKey-encoded Soroban
// contract ID (C...).
func ValidateContractAddress(address string) error {
	return validateAddress(address, strkey.VersionByteContract, "contract address (C...)")
}

func validateAddress(address string, expected strkey.VersionByte, label string) error {
	if address == "" {
		return ErrAddressEmpty
	}

	version, payload, err := strkey.DecodeAny(address)
	if err != nil {
		return ErrAddressMalformed
	}
	if version != expected {
		return fmt.Errorf("%w: expected %s", ErrAddressWrongVersion, label)
	}
	// Account and contract IDs both use a 32-byte payload. StrKey itself
	// permits variable-length payloads, so enforce the Stellar address shape
	// here rather than accepting a checksum-valid but unusable value.
	if len(payload) != 32 {
		return ErrAddressMalformed
	}
	return nil
}

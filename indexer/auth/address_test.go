package auth

import (
	"errors"
	"strings"
	"testing"

	"github.com/stellar/go-stellar-sdk/keypair"
	"github.com/stellar/go-stellar-sdk/strkey"
)

func validContractAddress(t *testing.T) string {
	t.Helper()

	raw := make([]byte, 32)
	for i := range raw {
		raw[i] = byte(i)
	}
	address, err := strkey.Encode(strkey.VersionByteContract, raw)
	if err != nil {
		t.Fatalf("encode contract address: %v", err)
	}
	return address
}

func corruptChecksum(address string) string {
	replacement := byte('A')
	if address[len(address)-1] == replacement {
		replacement = 'B'
	}
	return address[:len(address)-1] + string(replacement)
}

func TestValidateAccountAddress(t *testing.T) {
	accountKP, err := keypair.Random()
	if err != nil {
		t.Fatalf("generate account keypair: %v", err)
	}
	contract := validContractAddress(t)

	tests := []struct {
		name    string
		address string
		wantErr error
	}{
		{name: "valid G address", address: accountKP.Address()},
		{name: "empty", address: "", wantErr: ErrAddressEmpty},
		{name: "not a StrKey", address: "not-a-stellar-address", wantErr: ErrAddressMalformed},
		{name: "bad checksum", address: corruptChecksum(accountKP.Address()), wantErr: ErrAddressMalformed},
		{name: "contract instead of account", address: contract, wantErr: ErrAddressWrongVersion},
		{name: "seed instead of account", address: accountKP.Seed(), wantErr: ErrAddressWrongVersion},
		{name: "account version with short payload", address: shortAccountStrkey(t), wantErr: ErrAddressMalformed},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidateAccountAddress(tt.address)
			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("got error %v, want %v", err, tt.wantErr)
			}
		})
	}
}

func TestValidateContractAddress(t *testing.T) {
	accountKP, err := keypair.Random()
	if err != nil {
		t.Fatalf("generate account keypair: %v", err)
	}
	contract := validContractAddress(t)

	tests := []struct {
		name    string
		address string
		wantErr error
	}{
		{name: "valid C address", address: contract},
		{name: "empty", address: "", wantErr: ErrAddressEmpty},
		{name: "not a StrKey", address: "not-a-stellar-address", wantErr: ErrAddressMalformed},
		{name: "bad checksum", address: corruptChecksum(contract), wantErr: ErrAddressMalformed},
		{name: "account instead of contract", address: accountKP.Address(), wantErr: ErrAddressWrongVersion},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidateContractAddress(tt.address)
			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("got error %v, want %v", err, tt.wantErr)
			}
		})
	}
}

func TestValidateAddressWrongVersionNamesExpectedKind(t *testing.T) {
	contract := validContractAddress(t)

	err := ValidateAccountAddress(contract)
	if err == nil {
		t.Fatal("expected wrong-version error")
	}
	if !strings.Contains(err.Error(), "account address (G...)") {
		t.Errorf("error should name the expected kind, got %q", err.Error())
	}
}

func shortAccountStrkey(t *testing.T) string {
	t.Helper()

	address, err := strkey.Encode(strkey.VersionByteAccountID, make([]byte, 16))
	if err != nil {
		t.Fatalf("encode short account StrKey: %v", err)
	}
	return address
}

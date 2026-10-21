package auth

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/stellar/go-stellar-sdk/keypair"
	"github.com/stellar/go-stellar-sdk/txnbuild"
)

const testNetworkPassphrase = "Test SDF Network ; September 2015"

// signChallengeAs signs challengeXDR with each of signers and re-encodes it.
func signChallengeAs(t *testing.T, challengeXDR string, signers ...*keypair.Full) string {
	t.Helper()
	genericTx, err := txnbuild.TransactionFromXDR(challengeXDR)
	if err != nil {
		t.Fatalf("parse challenge XDR: %v", err)
	}
	tx, ok := genericTx.Transaction()
	if !ok {
		t.Fatal("expected a regular transaction")
	}
	tx, err = tx.Sign(testNetworkPassphrase, signers...)
	if err != nil {
		t.Fatalf("sign challenge: %v", err)
	}
	signed, err := tx.Base64()
	if err != nil {
		t.Fatalf("encode signed challenge: %v", err)
	}
	return signed
}

func TestGenerateChallenge_ProducesServerSignedManageDataTx(t *testing.T) {
	serverKP, _ := keypair.Random()
	clientKP, _ := keypair.Random()

	challenge, err := GenerateChallenge(serverKP, clientKP.Address(), testNetworkPassphrase)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	genericTx, err := txnbuild.TransactionFromXDR(challenge)
	if err != nil {
		t.Fatalf("parse challenge: %v", err)
	}
	tx, ok := genericTx.Transaction()
	if !ok {
		t.Fatal("expected a regular transaction")
	}
	if tx.SourceAccount().AccountID != serverKP.Address() {
		t.Errorf("source account: got %q, want %q", tx.SourceAccount().AccountID, serverKP.Address())
	}
	if len(tx.Operations()) != 1 {
		t.Fatalf("expected exactly 1 operation, got %d", len(tx.Operations()))
	}
	op, ok := tx.Operations()[0].(*txnbuild.ManageData)
	if !ok {
		t.Fatalf("expected ManageData operation, got %T", tx.Operations()[0])
	}
	if op.Name != ChallengeOperationName {
		t.Errorf("operation name: got %q, want %q", op.Name, ChallengeOperationName)
	}
	if op.SourceAccount != clientKP.Address() {
		t.Errorf("operation source: got %q, want %q", op.SourceAccount, clientKP.Address())
	}
	if len(tx.Signatures()) != 1 {
		t.Errorf("expected the server signature only, got %d signatures", len(tx.Signatures()))
	}
}

func TestGenerateChallenge_RejectsNonAccountClientAddresses(t *testing.T) {
	serverKP, _ := keypair.Random()
	clientKP, _ := keypair.Random()

	tests := []struct {
		name    string
		address string
		wantErr error
	}{
		{name: "contract address", address: validContractAddress(t), wantErr: ErrAddressWrongVersion},
		{name: "seed", address: clientKP.Seed(), wantErr: ErrAddressWrongVersion},
		{name: "bad checksum", address: corruptChecksum(clientKP.Address()), wantErr: ErrAddressMalformed},
		{name: "empty", address: "", wantErr: ErrAddressEmpty},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, err := GenerateChallenge(serverKP, tt.address, testNetworkPassphrase); !errors.Is(err, tt.wantErr) {
				t.Fatalf("got error %v, want %v", err, tt.wantErr)
			}
		})
	}
}

func TestVerifyChallenge_RoundTripReturnsClientAddress(t *testing.T) {
	serverKP, _ := keypair.Random()
	clientKP, _ := keypair.Random()

	challenge, err := GenerateChallenge(serverKP, clientKP.Address(), testNetworkPassphrase)
	if err != nil {
		t.Fatalf("generate challenge: %v", err)
	}
	signed := signChallengeAs(t, challenge, clientKP)

	got, err := VerifyChallenge(signed, serverKP, testNetworkPassphrase)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != clientKP.Address() {
		t.Errorf("client address: got %q, want %q", got, clientKP.Address())
	}
}

func TestVerifyChallenge_MissingClientSignature(t *testing.T) {
	serverKP, _ := keypair.Random()
	clientKP, _ := keypair.Random()

	challenge, err := GenerateChallenge(serverKP, clientKP.Address(), testNetworkPassphrase)
	if err != nil {
		t.Fatalf("generate challenge: %v", err)
	}

	_, err = VerifyChallenge(challenge, serverKP, testNetworkPassphrase)
	if err == nil || !strings.Contains(err.Error(), "missing client signature") {
		t.Fatalf("expected missing client signature error, got %v", err)
	}
}

func TestVerifyChallenge_WrongServerKeypair(t *testing.T) {
	serverKP, _ := keypair.Random()
	otherServerKP, _ := keypair.Random()
	clientKP, _ := keypair.Random()

	challenge, err := GenerateChallenge(serverKP, clientKP.Address(), testNetworkPassphrase)
	if err != nil {
		t.Fatalf("generate challenge: %v", err)
	}
	signed := signChallengeAs(t, challenge, clientKP)

	_, err = VerifyChallenge(signed, otherServerKP, testNetworkPassphrase)
	if err == nil || !strings.Contains(err.Error(), "invalid server source account") {
		t.Fatalf("expected invalid server source account error, got %v", err)
	}
}

func TestVerifyChallenge_ExpiredTimebounds(t *testing.T) {
	serverKP, _ := keypair.Random()
	clientKP, _ := keypair.Random()

	tx, err := txnbuild.NewTransaction(txnbuild.TransactionParams{
		SourceAccount: &txnbuild.SimpleAccount{
			AccountID: serverKP.Address(),
			Sequence:  0,
		},
		IncrementSequenceNum: false,
		BaseFee:              txnbuild.MinBaseFee,
		Preconditions: txnbuild.Preconditions{
			TimeBounds: txnbuild.NewTimebounds(
				time.Now().Add(-2*time.Hour).Unix(),
				time.Now().Add(-1*time.Hour).Unix(),
			),
		},
		Operations: []txnbuild.Operation{
			&txnbuild.ManageData{
				SourceAccount: clientKP.Address(),
				Name:          ChallengeOperationName,
				Value:         []byte("expired-test-nonce"),
			},
		},
	})
	if err != nil {
		t.Fatalf("build expired challenge: %v", err)
	}
	tx, err = tx.Sign(testNetworkPassphrase, serverKP, clientKP)
	if err != nil {
		t.Fatalf("sign expired challenge: %v", err)
	}
	signed, err := tx.Base64()
	if err != nil {
		t.Fatalf("encode expired challenge: %v", err)
	}

	_, err = VerifyChallenge(signed, serverKP, testNetworkPassphrase)
	if err == nil || !strings.Contains(err.Error(), "expired") {
		t.Fatalf("expected expiry error, got %v", err)
	}
}

func TestVerifyChallenge_MalformedXDR(t *testing.T) {
	serverKP, _ := keypair.Random()
	if _, err := VerifyChallenge("not-a-transaction", serverKP, testNetworkPassphrase); err == nil {
		t.Fatal("expected error for malformed XDR")
	}
}

func TestGenerateJWT_CarriesSubjectAndExpiry(t *testing.T) {
	const secret = "test-jwt-secret-for-unit-tests"
	address := "GACR43ILX6H4PGAOO5QKSZLU4ZJMGT3E66EAUDPLM5J6YTP4Y3PSHWGB"

	token, err := GenerateJWT(address, secret, 24)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	parsed, err := jwt.Parse(token, func(*jwt.Token) (interface{}, error) {
		return []byte(secret), nil
	}, jwt.WithValidMethods([]string{"HS256"}))
	if err != nil {
		t.Fatalf("parse token: %v", err)
	}

	claims, ok := parsed.Claims.(jwt.MapClaims)
	if !ok {
		t.Fatalf("unexpected claims type %T", parsed.Claims)
	}
	if claims["sub"] != address {
		t.Errorf("sub claim: got %v, want %q", claims["sub"], address)
	}
	exp, err := claims.GetExpirationTime()
	if err != nil || exp == nil {
		t.Fatalf("missing exp claim: %v", err)
	}
	if delta := time.Until(exp.Time); delta < 23*time.Hour || delta > 25*time.Hour {
		t.Errorf("exp claim should be ~24h out, got %v", delta)
	}
}

func TestGenerateJWT_RejectsTokenSignedWithAnotherSecret(t *testing.T) {
	token, err := GenerateJWT("GACR43ILX6H4PGAOO5QKSZLU4ZJMGT3E66EAUDPLM5J6YTP4Y3PSHWGB", "secret-a", 1)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if _, err := jwt.Parse(token, func(*jwt.Token) (interface{}, error) {
		return []byte("secret-b"), nil
	}, jwt.WithValidMethods([]string{"HS256"})); err == nil {
		t.Fatal("expected signature verification to fail with a different secret")
	}
}

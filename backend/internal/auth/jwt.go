package auth

import (
	"fmt"
	"time"

	"motor-platform/internal/models"

	"github.com/golang-jwt/jwt/v5"
)

type UserClaims struct {
	UserID    string          `json:"user_id"`
	Email     string          `json:"email"`
	FullName  string          `json:"full_name"`
	Role      models.UserRole `json:"role"`
	InsurerID *string         `json:"insurer_id,omitempty"`
	TeamID    *string         `json:"team_id,omitempty"`
	jwt.RegisteredClaims
}

func GenerateToken(user *models.User, secret string, expiryHours int) (string, time.Time, error) {
	expirationTime := time.Now().UTC().Add(time.Duration(expiryHours) * time.Hour)

	claims := &UserClaims{
		UserID:    user.ID,
		Email:     user.Email,
		FullName:  user.FullName,
		Role:      user.Role,
		InsurerID: user.InsurerID,
		TeamID:    user.TeamID,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(expirationTime),
			IssuedAt:  jwt.NewNumericDate(time.Now().UTC()),
			Issuer:    "motor-claim-verification-platform",
			Subject:   user.ID,
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenString, err := token.SignedString([]byte(secret))
	if err != nil {
		return "", time.Time{}, fmt.Errorf("failed to sign token: %w", err)
	}

	return tokenString, expirationTime, nil
}

func ValidateToken(tokenString, secret string) (*UserClaims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &UserClaims{}, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return []byte(secret), nil
	})

	if err != nil {
		return nil, fmt.Errorf("invalid token: %w", err)
	}

	if claims, ok := token.Claims.(*UserClaims); ok && token.Valid {
		return claims, nil
	}

	return nil, fmt.Errorf("invalid token claims")
}

package auth

import (
	"net/http"
	"strings"

	"motor-platform/internal/models"

	"github.com/gin-gonic/gin"
)

const ClaimsKey = "currentUserClaims"

// AuthMiddleware extracts Bearer token, verifies signature, and injects claims into Gin context
func AuthMiddleware(secret string) gin.HandlerFunc {
	return func(c *gin.Context) {
		tokenStr := ""
		authHeader := c.GetHeader("Authorization")
		if authHeader != "" {
			parts := strings.SplitN(authHeader, " ", 2)
			if len(parts) == 2 && strings.EqualFold(parts[0], "Bearer") {
				tokenStr = parts[1]
			}
		}

		if tokenStr == "" {
			tokenStr = c.Query("token")
		}

		if tokenStr == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error": "missing authorization header or token query parameter",
			})
			return
		}

		claims, err := ValidateToken(tokenStr, secret)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error": "unauthorized: " + err.Error(),
			})
			return
		}

		c.Set(ClaimsKey, claims)
		c.Next()
	}
}

// RequireRole checks whether the authenticated user has one of the specified allowed roles
func RequireRole(allowedRoles ...models.UserRole) gin.HandlerFunc {
	return func(c *gin.Context) {
		claims, exists := GetUserClaims(c)
		if !exists {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error": "unauthorized",
			})
			return
		}

		for _, role := range allowedRoles {
			if claims.Role == role {
				c.Next()
				return
			}
		}

		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
			"error": "forbidden: insufficient permissions for this action",
		})
	}
}

// GetUserClaims retrieves the UserClaims from the request context
func GetUserClaims(c *gin.Context) (*UserClaims, bool) {
	val, exists := c.Get(ClaimsKey)
	if !exists {
		return nil, false
	}
	claims, ok := val.(*UserClaims)
	return claims, ok
}

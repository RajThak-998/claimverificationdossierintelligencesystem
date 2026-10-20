package handlers

import (
	"net/http"

	"motor-platform/internal/auth"
	"motor-platform/internal/config"
	"motor-platform/internal/models"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

type AuthHandler struct {
	db     *gorm.DB
	config *config.Config
}

func NewAuthHandler(db *gorm.DB, cfg *config.Config) *AuthHandler {
	return &AuthHandler{db: db, config: cfg}
}

type LoginRequest struct {
	Email    string `json:"email" binding:"required,email"`
	Password string `json:"password" binding:"required"`
}

type LoginResponse struct {
	Token     string       `json:"token"`
	ExpiresAt string       `json:"expires_at"`
	User      *models.User `json:"user"`
}

func (h *AuthHandler) Login(c *gin.Context) {
	var req LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid login credentials payload"})
		return
	}

	var user models.User
	if err := h.db.Preload("Insurer").Where("email = ? AND is_active = true", req.Email).First(&user).Error; err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid email or password"})
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password)); err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid email or password"})
		return
	}

	token, expiresAt, err := auth.GenerateToken(&user, h.config.JWTSecret, h.config.JWTExpirationHours)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate session token"})
		return
	}

	c.JSON(http.StatusOK, LoginResponse{
		Token:     token,
		ExpiresAt: expiresAt.Format("2006-01-02T15:04:05Z07:00"),
		User:      &user,
	})
}

func (h *AuthHandler) Me(c *gin.Context) {
	claims, exists := auth.GetUserClaims(c)
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var user models.User
	if err := h.db.Preload("Insurer").Where("id = ?", claims.UserID).First(&user).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user profile not found"})
		return
	}

	c.JSON(http.StatusOK, user)
}

func (h *AuthHandler) ListAgents(c *gin.Context) {
	var agents []models.User
	h.db.Where("role = ? AND is_active = true", models.RoleAgent).Find(&agents)

	type AgentSummary struct {
		ID               string `json:"id"`
		FullName         string `json:"full_name"`
		Email            string `json:"email"`
		ActiveCasesCount int64  `json:"active_cases_count"`
	}

	var result []AgentSummary
	for _, a := range agents {
		var activeCount int64
		h.db.Model(&models.Case{}).Where("assigned_agent_id = ? AND status IN (?, ?)", a.ID, models.StatusWorkInProgress, models.StatusReview).Count(&activeCount)
		result = append(result, AgentSummary{
			ID:               a.ID,
			FullName:         a.FullName,
			Email:            a.Email,
			ActiveCasesCount: activeCount,
		})
	}

	c.JSON(http.StatusOK, result)
}

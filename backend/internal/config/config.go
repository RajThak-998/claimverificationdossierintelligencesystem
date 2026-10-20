package config

import (
	"os"
	"strconv"
)

type Config struct {
	Port                     string
	AppEnv                   string
	DBDriver                 string
	DBDSN                    string
	RedisAddr                string
	RedisPassword            string
	StorageDriver            string
	StorageBaseDir           string
	StorageBaseURL           string
	StorageEndpoint          string
	StorageBucket            string
	StorageAccessKey         string
	StorageSecretKey         string
	StorageUseSSL            bool
	JWTSecret                string
	JWTExpirationHours       int
	BaseCaseFeeINR           float64
	DefaultPerMinuteRateINR  float64
	CORSAllowedOrigins       string
}

func getEnv(key, defaultVal string) string {
	val := os.Getenv(key)
	if val == "" {
		return defaultVal
	}
	return val
}

func getEnvBool(key string, defaultVal bool) bool {
	val := os.Getenv(key)
	if val == "" {
		return defaultVal
	}
	b, err := strconv.ParseBool(val)
	if err != nil {
		return defaultVal
	}
	return b
}

func getEnvInt(key string, defaultVal int) int {
	val := os.Getenv(key)
	if val == "" {
		return defaultVal
	}
	i, err := strconv.Atoi(val)
	if err != nil {
		return defaultVal
	}
	return i
}

func getEnvFloat(key string, defaultVal float64) float64 {
	val := os.Getenv(key)
	if val == "" {
		return defaultVal
	}
	f, err := strconv.ParseFloat(val, 64)
	if err != nil {
		return defaultVal
	}
	return f
}

func LoadConfig() *Config {
	return &Config{
		Port:                    getEnv("PORT", "8080"),
		AppEnv:                  getEnv("APP_ENV", "development"),
		DBDriver:                getEnv("DB_DRIVER", "postgres"),
		DBDSN:                   getEnv("DB_DSN", "postgres://postgres:SecretPostgresPass123!@localhost:5432/motor_claims?sslmode=disable"),
		RedisAddr:               getEnv("REDIS_ADDR", "localhost:6379"),
		RedisPassword:           getEnv("REDIS_PASSWORD", ""),
		StorageDriver:           getEnv("STORAGE_DRIVER", "local"),
		StorageBaseDir:          getEnv("STORAGE_BASE_DIR", "data/storage"),
		StorageBaseURL:          getEnv("STORAGE_BASE_URL", "http://localhost:8080"),
		StorageEndpoint:         getEnv("STORAGE_ENDPOINT", "localhost:9000"),
		StorageBucket:           getEnv("STORAGE_BUCKET", "motor-claims-vault"),
		StorageAccessKey:        getEnv("STORAGE_ACCESS_KEY", "minioadmin"),
		StorageSecretKey:        getEnv("STORAGE_SECRET_KEY", "minioadminpassword123"),
		StorageUseSSL:           getEnvBool("STORAGE_USE_SSL", false),
		JWTSecret:               getEnv("JWT_SECRET", "super-secret-jwt-signing-key-32chars"),
		JWTExpirationHours:      getEnvInt("JWT_EXPIRATION_HOURS", 24),
		BaseCaseFeeINR:          getEnvFloat("BASE_CASE_FEE_INR", 750.00),
		DefaultPerMinuteRateINR: getEnvFloat("DEFAULT_PER_MINUTE_RATE_INR", 45.00),
		CORSAllowedOrigins:      getEnv("CORS_ALLOWED_ORIGINS", "*"),
	}
}

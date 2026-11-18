package pdf

import (
	"context"
	"strings"
	"testing"
	"time"
)

func TestFormatDuration(t *testing.T) {
	tests := []struct {
		input    int
		expected string
	}{
		{0, "00m 00s"},
		{45, "00m 45s"},
		{65, "01m 05s"},
		{3665, "01h 01m 05s"},
	}

	for _, tt := range tests {
		got := FormatDuration(tt.input)
		if got != tt.expected {
			t.Errorf("FormatDuration(%d) = %s; want %s", tt.input, got, tt.expected)
		}
	}
}

func TestRenderHTMLToPDF(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	sampleHTML := []byte(`<!DOCTYPE html>
<html>
<head><title>Test PDF</title></head>
<body>
<h1>Motor Claim Verification Platform</h1>
<p>Testing headless chrome PDF generation.</p>
</body>
</html>`)

	pdfBytes, err := renderHTMLToPDF(ctx, sampleHTML)
	if err != nil {
		t.Skipf("Skipping render test if chromium not available in test env: %v", err)
		return
	}

	if len(pdfBytes) == 0 {
		t.Fatalf("Expected non-empty PDF bytes, got 0")
	}

	// Valid PDF begins with %PDF-
	if !strings.HasPrefix(string(pdfBytes[:8]), "%PDF-") {
		t.Errorf("Expected PDF header starting with %%PDF-, got: %s", string(pdfBytes[:8]))
	}
}

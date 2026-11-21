//go:build !windows

package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

// Fuera de Windows (sólo pruebas con -simular): sin DPAPI. El archivo queda con permisos 0600 y SIN cifrar: no usar con personas reales.
func proteger(d []byte) ([]byte, error) { return append([]byte("SIN-DPAPI:"), d...), nil }
func desproteger(d []byte) ([]byte, error) {
	if len(d) < 10 || string(d[:10]) != "SIN-DPAPI:" {
		return nil, errors.New("formato")
	}
	return d[10:], nil
}
func carpetaDatos() string {
	if v := os.Getenv("VBONG_HUELLAS_DIR"); v != "" {
		return v
	}
	b, _ := os.UserConfigDir()
	return filepath.Join(b, "vbong-huellas")
}
func avisar(titulo, texto string)         { fmt.Println("[" + titulo + "] " + texto) }
func inicioAutomatico(activar bool) error { return errors.New("sólo en Windows") }

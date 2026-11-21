package main

import (
	"bytes"
	"crypto/sha256"
	"sync"
	"time"
)

// Lector simulado, SÓLO para pruebas automáticas (se activa con -simular). Cada «dedo» es un texto que la prueba
// pone con POST /sim/dedo; la plantilla es un hash del texto. No sirve para uso real y lo dice en /estado.
type lectorSim struct {
	mu    sync.Mutex
	dedo  string
	cache map[uint32][]byte
}

func nuevoSim() *lectorSim           { return &lectorSim{cache: map[uint32][]byte{}} }
func (l *lectorSim) Nombre() string  { return "Lector SIMULADO (pruebas)" }
func (l *lectorSim) SDK() bool       { return true }
func (l *lectorSim) Conectado() bool { return true }
func (l *lectorSim) Info() map[string]interface{} {
	return map[string]interface{}{"modelo": "SIMULADO", "ancho": 300, "alto": 400, "dpi": 500, "simulado": true}
}
func (l *lectorSim) Reconectar() error  { return nil }
func (l *lectorSim) PonerDedo(d string) { l.mu.Lock(); l.dedo = d; l.mu.Unlock() }
func (l *lectorSim) Capturar(cancel <-chan struct{}) ([]byte, error) {
	for i := 0; i < 200; i++ {
		select {
		case <-cancel:
			return nil, ErrCancelado
		default:
		}
		l.mu.Lock()
		d := l.dedo
		l.dedo = ""
		l.mu.Unlock()
		if d != "" {
			h := sha256.Sum256([]byte("dedo|" + d))
			return h[:], nil
		}
		time.Sleep(50 * time.Millisecond)
	}
	return nil, ErrSinDedo
}
func (l *lectorSim) Fusionar(a, b, c []byte) ([]byte, error) {
	if !bytes.Equal(a, b) || !bytes.Equal(b, c) {
		return nil, ErrFusion
	}
	return append([]byte{}, a...), nil
}
func (l *lectorSim) Cargar(fid uint32, t []byte) error {
	l.mu.Lock()
	l.cache[fid] = t
	l.mu.Unlock()
	return nil
}
func (l *lectorSim) Quitar(fid uint32) error {
	l.mu.Lock()
	delete(l.cache, fid)
	l.mu.Unlock()
	return nil
}
func (l *lectorSim) Identificar(t []byte) (uint32, int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	for f, x := range l.cache {
		if bytes.Equal(x, t) {
			return f, 99, nil
		}
	}
	return 0, 0, ErrSinCoinc
}
func (l *lectorSim) Comparar(a, b []byte) int {
	if bytes.Equal(a, b) {
		return 99
	}
	return 0
}

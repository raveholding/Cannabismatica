package main

import "errors"

// Lector: lo mínimo que el agente necesita de un lector de huellas.
// La implementación real (ZKTeco, libzkfp.dll) está en lector_zk_windows.go; la simulada (pruebas) en lector_sim.go.
type Lector interface {
	Nombre() string
	SDK() bool                                       // ¿se cargó la biblioteca del fabricante?
	Conectado() bool                                 // ¿hay un lector enchufado y abierto?
	Info() map[string]interface{}                    // ancho, alto, dpi, modelo (sin datos de personas)
	Reconectar() error                               // vuelve a buscar el lector (al enchufar o desenchufar)
	Capturar(cancel <-chan struct{}) ([]byte, error) // espera un dedo y devuelve la plantilla (nunca la imagen)
	Fusionar(t1, t2, t3 []byte) ([]byte, error)      // 3 capturas del mismo dedo → plantilla de registro
	Cargar(fid uint32, t []byte) error               // agrega una plantilla al caché 1:N
	Quitar(fid uint32) error
	Identificar(t []byte) (fid uint32, score int, err error) // 1:N
	Comparar(a, b []byte) int                                // 1:1 (puntaje, <=0 no coincide)
}

var (
	ErrSinDedo   = errors.New("sin_dedo")
	ErrCancelado = errors.New("cancelado")
	ErrSinLector = errors.New("sin_lector")
	ErrSinSDK    = errors.New("sin_sdk")
	ErrSinCoinc  = errors.New("sin_coincidencia")
	ErrFusion    = errors.New("fusion")
)

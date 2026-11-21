//go:build !windows

package main

// Fuera de Windows no hay SDK de ZKTeco: el agente sólo sirve con -simular (pruebas).
func nuevoLector() Lector { return &sinSDK{} }

type sinSDK struct{}

func (sinSDK) Nombre() string                           { return "sin SDK (sólo Windows)" }
func (sinSDK) SDK() bool                                { return false }
func (sinSDK) Conectado() bool                          { return false }
func (sinSDK) Info() map[string]interface{}             { return map[string]interface{}{} }
func (sinSDK) Reconectar() error                        { return ErrSinSDK }
func (sinSDK) Capturar(<-chan struct{}) ([]byte, error) { return nil, ErrSinSDK }
func (sinSDK) Fusionar(a, b, c []byte) ([]byte, error)  { return nil, ErrSinSDK }
func (sinSDK) Cargar(uint32, []byte) error              { return ErrSinSDK }
func (sinSDK) Quitar(uint32) error                      { return nil }
func (sinSDK) Identificar([]byte) (uint32, int, error)  { return 0, 0, ErrSinSDK }
func (sinSDK) Comparar(a, b []byte) int                 { return 0 }

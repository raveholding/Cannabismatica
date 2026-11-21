//go:build windows

package main

// Lector ZKTeco (ZK9500, ZK4500, SLK20R, Live20R…) con la biblioteca oficial libzkfp.dll del «ZKFinger SDK for Windows».
// La DLL la instala el SDK/driver de ZKTeco (no se distribuye con este agente). Firmas tomadas del envoltorio oficial
// libzkfpcsharp.dll (P/Invoke): ZKFPM_Init, ZKFPM_GetDeviceCount, ZKFPM_OpenDevice, ZKFPM_GetCaptureParamsEx,
// ZKFPM_AcquireFingerprint, ZKFPM_CreateDBCache, ZKFPM_GenRegTemplate, ZKFPM_AddRegTemplateToDBCache,
// ZKFPM_DelRegTemplateFromDBCache, ZKFPM_Identify, ZKFPM_MatchFinger, ZKFPM_SetParameters. Retorno 0 = bien; -8 = sin dedo.
// [VERIFICAR con el lector físico]: probado sólo al compilar; falta la prueba con el ZK9500 real.

import (
	"errors"
	"fmt"
	"sync"
	"syscall"
	"time"
	"unsafe"
)

const tplMax = 2048

type lectorZK struct {
	mu                                                                                             sync.Mutex
	dll                                                                                            *syscall.LazyDLL
	fInit, fCount, fOpen, fClose, fParams, fAcq, fCreateDB, fGen, fAdd, fDel, fIdent, fMatch, fSet *syscall.LazyProc
	iniciado                                                                                       bool
	dev, db                                                                                        uintptr
	ancho, alto, dpi                                                                               int32
	cargadas                                                                                       map[uint32][]byte
}

func nuevoLector() Lector {
	l := &lectorZK{dll: syscall.NewLazyDLL("libzkfp.dll"), cargadas: map[uint32][]byte{}}
	p := l.dll.NewProc
	l.fInit, l.fCount, l.fOpen, l.fClose = p("ZKFPM_Init"), p("ZKFPM_GetDeviceCount"), p("ZKFPM_OpenDevice"), p("ZKFPM_CloseDevice")
	l.fParams, l.fAcq, l.fCreateDB, l.fGen = p("ZKFPM_GetCaptureParamsEx"), p("ZKFPM_AcquireFingerprint"), p("ZKFPM_CreateDBCache"), p("ZKFPM_GenRegTemplate")
	l.fAdd, l.fDel, l.fIdent, l.fMatch, l.fSet = p("ZKFPM_AddRegTemplateToDBCache"), p("ZKFPM_DelRegTemplateFromDBCache"), p("ZKFPM_Identify"), p("ZKFPM_MatchFinger"), p("ZKFPM_SetParameters")
	_ = l.Reconectar()
	return l
}

func (l *lectorZK) Nombre() string  { return "ZKTeco (libzkfp.dll)" }
func (l *lectorZK) SDK() bool       { return l.dll.Load() == nil && l.fInit.Find() == nil }
func (l *lectorZK) Conectado() bool { l.mu.Lock(); defer l.mu.Unlock(); return l.dev != 0 }
func (l *lectorZK) Info() map[string]interface{} {
	l.mu.Lock()
	defer l.mu.Unlock()
	return map[string]interface{}{"modelo": "ZKTeco", "ancho": l.ancho, "alto": l.alto, "dpi": l.dpi}
}

func (l *lectorZK) Reconectar() error {
	l.mu.Lock()
	defer l.mu.Unlock()
	if !l.SDK() {
		return ErrSinSDK
	}
	if l.dev != 0 { // ¿sigue enchufado?
		n, _, _ := l.fCount.Call()
		if int32(n) > 0 {
			return nil
		}
		l.fClose.Call(l.dev)
		l.dev = 0
	}
	if !l.iniciado {
		r, _, _ := l.fInit.Call()
		if int32(r) != 0 && int32(r) != 1 { // 1 = ya iniciado
			return fmt.Errorf("init %d", int32(r))
		}
		l.iniciado = true
	}
	n, _, _ := l.fCount.Call()
	if int32(n) <= 0 {
		return ErrSinLector
	}
	h, _, _ := l.fOpen.Call(0)
	if h == 0 {
		return ErrSinLector
	}
	l.dev = h
	l.fParams.Call(h, uintptr(unsafe.Pointer(&l.ancho)), uintptr(unsafe.Pointer(&l.alto)), uintptr(unsafe.Pointer(&l.dpi)))
	if l.db == 0 {
		l.db, _, _ = l.fCreateDB.Call()
	}
	for f, t := range l.cargadas { // al reconectar, el caché del algoritmo se vuelve a cargar
		l.fAdd.Call(l.db, uintptr(f), uintptr(unsafe.Pointer(&t[0])), uintptr(len(t)))
	}
	return nil
}

func (l *lectorZK) Capturar(cancel <-chan struct{}) ([]byte, error) {
	if l.dev == 0 {
		if err := l.Reconectar(); err != nil {
			return nil, err
		}
	}
	tam := int(l.ancho) * int(l.alto)
	if tam <= 0 || tam > 4<<20 {
		tam = 1 << 20
	}
	img := make([]byte, tam)
	defer func() {
		for i := range img {
			img[i] = 0
		}
	}() // la imagen nunca sale de acá
	tpl := make([]byte, tplMax)
	limite := time.Now().Add(20 * time.Second)
	for time.Now().Before(limite) {
		select {
		case <-cancel:
			return nil, ErrCancelado
		default:
		}
		cb := int32(tplMax)
		l.mu.Lock()
		r, _, _ := l.fAcq.Call(l.dev, uintptr(unsafe.Pointer(&img[0])), uintptr(tam), uintptr(unsafe.Pointer(&tpl[0])), uintptr(unsafe.Pointer(&cb)))
		l.mu.Unlock()
		if int32(r) == 0 && cb > 0 && cb <= tplMax {
			return append([]byte{}, tpl[:cb]...), nil
		}
		if int32(r) == -3 || int32(r) == -7 { // sin lector / manija inválida: se desenchufó
			l.mu.Lock()
			l.dev = 0
			l.mu.Unlock()
			return nil, ErrSinLector
		}
		time.Sleep(120 * time.Millisecond)
	}
	return nil, ErrSinDedo
}

func (l *lectorZK) Fusionar(a, b, c []byte) ([]byte, error) {
	if len(a) == 0 || len(b) == 0 || len(c) == 0 {
		return nil, ErrFusion
	}
	reg := make([]byte, tplMax)
	cb := int32(tplMax)
	l.mu.Lock()
	r, _, _ := l.fGen.Call(l.db, uintptr(unsafe.Pointer(&a[0])), uintptr(unsafe.Pointer(&b[0])), uintptr(unsafe.Pointer(&c[0])), uintptr(unsafe.Pointer(&reg[0])), uintptr(unsafe.Pointer(&cb)))
	l.mu.Unlock()
	if int32(r) != 0 || cb <= 0 || cb > tplMax {
		return nil, ErrFusion
	}
	return append([]byte{}, reg[:cb]...), nil
}

func (l *lectorZK) Cargar(fid uint32, t []byte) error {
	if len(t) == 0 {
		return errors.New("plantilla vacía")
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	l.cargadas[fid] = t
	if l.db == 0 {
		if !l.SDK() {
			return ErrSinSDK
		}
		if !l.iniciado {
			l.fInit.Call()
			l.iniciado = true
		}
		l.db, _, _ = l.fCreateDB.Call()
	}
	r, _, _ := l.fAdd.Call(l.db, uintptr(fid), uintptr(unsafe.Pointer(&t[0])), uintptr(len(t)))
	if int32(r) != 0 {
		return fmt.Errorf("agregar %d", int32(r))
	}
	return nil
}

func (l *lectorZK) Quitar(fid uint32) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.cargadas, fid)
	if l.db != 0 {
		l.fDel.Call(l.db, uintptr(fid))
	}
	return nil
}

func (l *lectorZK) Identificar(t []byte) (uint32, int, error) {
	if len(t) == 0 || l.db == 0 {
		return 0, 0, ErrSinCoinc
	}
	var fid, score int32
	l.mu.Lock()
	r, _, _ := l.fIdent.Call(l.db, uintptr(unsafe.Pointer(&t[0])), uintptr(len(t)), uintptr(unsafe.Pointer(&fid)), uintptr(unsafe.Pointer(&score)))
	l.mu.Unlock()
	if int32(r) != 0 || fid <= 0 {
		return 0, 0, ErrSinCoinc
	}
	return uint32(fid), int(score), nil
}

func (l *lectorZK) Comparar(a, b []byte) int {
	if len(a) == 0 || len(b) == 0 || l.db == 0 {
		return 0
	}
	l.mu.Lock()
	r, _, _ := l.fMatch.Call(l.db, uintptr(unsafe.Pointer(&a[0])), uintptr(len(a)), uintptr(unsafe.Pointer(&b[0])), uintptr(len(b)))
	l.mu.Unlock()
	return int(int32(r))
}

// luz verde / roja del lector (códigos 102/103 del SDK; si el modelo no la tiene, no pasa nada)
func (l *lectorZK) Luz(verde bool) {
	if l.dev == 0 || l.fSet.Find() != nil {
		return
	}
	code := uintptr(103)
	if verde {
		code = 102
	}
	v := []byte{1, 0, 0, 0}
	l.fSet.Call(l.dev, code, uintptr(unsafe.Pointer(&v[0])), 4)
	go func() {
		time.Sleep(600 * time.Millisecond)
		z := []byte{0, 0, 0, 0}
		l.mu.Lock()
		if l.dev != 0 {
			l.fSet.Call(l.dev, code, uintptr(unsafe.Pointer(&z[0])), 4)
		}
		l.mu.Unlock()
	}()
}

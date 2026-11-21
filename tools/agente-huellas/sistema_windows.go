//go:build windows

package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"unsafe"
)

var (
	crypt32    = syscall.NewLazyDLL("crypt32.dll")
	user32     = syscall.NewLazyDLL("user32.dll")
	kernel32   = syscall.NewLazyDLL("kernel32.dll")
	pProtect   = crypt32.NewProc("CryptProtectData")
	pUnprotect = crypt32.NewProc("CryptUnprotectData")
	pMsgBox    = user32.NewProc("MessageBoxW")
	pLocalFree = kernel32.NewProc("LocalFree")
)

type blob struct {
	cb uint32
	pb *byte
}

func nb(d []byte) *blob {
	if len(d) == 0 {
		return &blob{}
	}
	return &blob{cb: uint32(len(d)), pb: &d[0]}
}
func (b *blob) bytes() []byte {
	out := make([]byte, b.cb)
	copy(out, unsafe.Slice(b.pb, b.cb))
	return out
}

// Cifrado con DPAPI de Windows (atado a ESTE usuario de ESTA PC): las plantillas no se pueden leer copiando el archivo a otro equipo.
func proteger(d []byte) ([]byte, error) {
	var out blob
	r, _, err := pProtect.Call(uintptr(unsafe.Pointer(nb(d))), 0, 0, 0, 0, 0x1 /*UI_FORBIDDEN*/, uintptr(unsafe.Pointer(&out)))
	if r == 0 {
		return nil, err
	}
	defer pLocalFree.Call(uintptr(unsafe.Pointer(out.pb)))
	return out.bytes(), nil
}
func desproteger(d []byte) ([]byte, error) {
	var out blob
	r, _, err := pUnprotect.Call(uintptr(unsafe.Pointer(nb(d))), 0, 0, 0, 0, 0x1, uintptr(unsafe.Pointer(&out)))
	if r == 0 {
		return nil, err
	}
	defer pLocalFree.Call(uintptr(unsafe.Pointer(out.pb)))
	return out.bytes(), nil
}

func carpetaDatos() string {
	b := os.Getenv("LOCALAPPDATA")
	if b == "" {
		b, _ = os.UserConfigDir()
	}
	return filepath.Join(b, "VBONG-Huellas")
}

func avisar(titulo, texto string) {
	t, _ := syscall.UTF16PtrFromString(titulo)
	x, _ := syscall.UTF16PtrFromString(texto)
	go pMsgBox.Call(0, uintptr(unsafe.Pointer(x)), uintptr(unsafe.Pointer(t)), 0x40|0x40000|0x10000 /*INFO|TOPMOST|SETFOREGROUND*/)
}

// Inicio automático con Windows (sólo para este usuario; se quita con -desinstalar).
func inicioAutomatico(activar bool) error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	if !activar {
		return exec.Command("reg", "delete", `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`, "/v", "VBONG-Huellas", "/f").Run()
	}
	dst := filepath.Join(carpetaDatos(), "vbong-huellas.exe")
	if !mismoArchivo(exe, dst) {
		os.MkdirAll(carpetaDatos(), 0o700)
		if b, err := os.ReadFile(exe); err == nil {
			os.WriteFile(dst, b, 0o700)
		}
	}
	return exec.Command("reg", "add", `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`, "/v", "VBONG-Huellas", "/t", "REG_SZ", "/d", `"`+dst+`" -silencioso`, "/f").Run()
}

func mismoArchivo(a, b string) bool {
	fa, e1 := os.Stat(a)
	fb, e2 := os.Stat(b)
	return e1 == nil && e2 == nil && os.SameFile(fa, fb)
}

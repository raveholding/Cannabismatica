// Sistema VB ONG · Agente local del lector de huellas (VINCULAR BUSINESS · (387) 4484132 · vincularbusiness@gmail.com)
//
// El navegador no puede hablar con un lector de huellas USB: este programa corre en la PC donde está enchufado el lector,
// escucha SÓLO en 127.0.0.1 (no se ve desde la red) y le contesta al sistema web. Reglas:
//
//	· Acepta sólo pedidos de los orígenes de la lista (por defecto https://raveholding.github.io).
//	· Hay que emparejarlo una vez: el sistema pide un código, el agente lo muestra en ESTA PC y se tipea en el sistema.
//	  Desde ahí cada pedido y cada respuesta van firmados (HMAC-SHA256 con la clave del emparejamiento, sello de tiempo
//	  y número de un solo uso): una página o un programa que no tenga la clave no puede usar el lector ni falsificar una respuesta.
//	· Nunca guarda ni devuelve la IMAGEN de la huella. Guarda la PLANTILLA (lo que el SDK usa para comparar) cifrada con
//	  DPAPI de Windows, atada a este usuario y esta PC. Al sistema sólo le devuelve la referencia del legajo y un hash.
//	· La identificación 1:N la hace el SDK acá, en la PC. Sin agente o sin lector, el sistema sigue funcionando a mano.
package main

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"math/big"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

const version = "1.0.0 (2026-11-21)"

type Config struct {
	Puerto   int      `json:"puerto"`
	Origenes []string `json:"origenes"`
	Equipo   string   `json:"equipo"`
	Clave    string   `json:"clave,omitempty"` // base64; se guarda cifrada (DPAPI) en clave.bin, nunca en el json
	MinScore int      `json:"min_score"`
}

type Plantilla struct {
	Fid  uint32 `json:"fid"`
	Tpl  string `json:"tpl"` // base64 de la plantilla del SDK
	Hash string `json:"hash"`
	Dedo string `json:"dedo"`
	Ts   string `json:"ts"`
}

type Trabajo struct {
	ID        string                 `json:"id"`
	Tipo      string                 `json:"tipo"`
	Estado    string                 `json:"estado"` // esperando | levantar | listo | error | cancelado
	Paso      int                    `json:"paso"`
	Pasos     int                    `json:"pasos"`
	Mensaje   string                 `json:"mensaje"`
	Resultado map[string]interface{} `json:"resultado,omitempty"`
	cancel    chan struct{}
	fin       time.Time
}

var (
	cfg       Config
	clave     []byte
	lector    Lector
	sim       *lectorSim
	mu        sync.Mutex
	plant     = map[string]*Plantilla{} // ref → plantilla
	trabajo   *Trabajo
	nonces    = map[string]time.Time{}
	codigo    string
	codigoVto time.Time
	intentos  int
	reRef     = regexp.MustCompile(`^[A-Za-z0-9_-]{3,40}$`)
)

func dir(n string) string { return filepath.Join(carpetaDatos(), n) }

func azar(n int) []byte { b := make([]byte, n); rand.Read(b); return b }

func cargar() {
	os.MkdirAll(carpetaDatos(), 0o700)
	cfg = Config{Puerto: 52181, Origenes: []string{"https://raveholding.github.io"}, MinScore: 0}
	if b, err := os.ReadFile(dir("agente.json")); err == nil {
		json.Unmarshal(b, &cfg)
	}
	if cfg.Equipo == "" {
		cfg.Equipo = "PC-" + strings.ToUpper(hex.EncodeToString(azar(4)))
	}
	guardarCfg()
	if b, err := os.ReadFile(dir("clave.bin")); err == nil {
		if k, err := desproteger(b); err == nil && len(k) == 32 {
			clave = k
		}
	}
	if b, err := os.ReadFile(dir("plantillas.bin")); err == nil {
		if d, err := desproteger(b); err == nil {
			json.Unmarshal(d, &plant)
		} else {
			log.Println("no se pudieron abrir las plantillas (¿otro usuario de Windows?):", err)
		}
	}
	for _, p := range plant {
		if t, err := base64.StdEncoding.DecodeString(p.Tpl); err == nil {
			lector.Cargar(p.Fid, t)
		}
	}
}

func guardarCfg() {
	c := cfg
	c.Clave = ""
	b, _ := json.MarshalIndent(c, "", "  ")
	os.WriteFile(dir("agente.json"), b, 0o600)
}

func guardarPlantillas() error {
	b, _ := json.Marshal(plant)
	e, err := proteger(b)
	if err != nil {
		return err
	}
	tmp := dir("plantillas.tmp")
	if err := os.WriteFile(tmp, e, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, dir("plantillas.bin"))
}

func origenOk(o string) bool {
	for _, x := range cfg.Origenes {
		if o == x {
			return true
		}
	}
	return false
}

func firmar(partes ...string) string {
	m := hmac.New(sha256.New, clave)
	m.Write([]byte(strings.Join(partes, "\n")))
	return hex.EncodeToString(m.Sum(nil))
}

// verifica la firma del pedido (sello de tiempo ±120 s y número de un solo uso)
func verificar(r *http.Request, cuerpo []byte) (string, bool) {
	if len(clave) != 32 {
		return "", false
	}
	ts, nonce, f := r.Header.Get("X-VB-Ts"), r.Header.Get("X-VB-Nonce"), r.Header.Get("X-VB-Firma")
	t, err := strconv.ParseInt(ts, 10, 64)
	if err != nil || len(nonce) < 16 || len(nonce) > 64 || len(f) != 64 {
		return "", false
	}
	if d := time.Now().UnixMilli() - t; d > 120000 || d < -120000 {
		return "", false
	}
	esp := firmar(r.Method, r.URL.Path, ts, nonce, string(cuerpo))
	if subtle.ConstantTimeCompare([]byte(esp), []byte(f)) != 1 {
		return "", false
	}
	mu.Lock()
	defer mu.Unlock()
	for k, v := range nonces {
		if time.Since(v) > 5*time.Minute {
			delete(nonces, k)
		}
	}
	if _, ya := nonces[nonce]; ya {
		return "", false
	}
	nonces[nonce] = time.Now()
	return nonce, true
}

func responder(w http.ResponseWriter, nonce string, code int, v interface{}) {
	b, _ := json.Marshal(v)
	if nonce != "" && len(clave) == 32 {
		w.Header().Set("X-VB-Firma", firmar(nonce, string(b)))
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(code)
	w.Write(b)
}

func estadoPublico() map[string]interface{} {
	mu.Lock()
	n := len(plant)
	tr := ""
	if trabajo != nil && (trabajo.Estado == "esperando" || trabajo.Estado == "levantar") {
		tr = trabajo.Tipo
	}
	mu.Unlock()
	return map[string]interface{}{
		"agente": "vbong-huellas", "version": version, "equipo": cfg.Equipo, "sdk": lector.SDK(), "lector": lector.Conectado(),
		"modelo": lector.Nombre(), "info": lector.Info(), "emparejado": len(clave) == 32, "plantillas": n, "ocupado": tr, "simulado": sim != nil,
	}
}

func nuevoTrabajo(tipo string, pasos int) (*Trabajo, bool) {
	mu.Lock()
	defer mu.Unlock()
	if trabajo != nil && (trabajo.Estado == "esperando" || trabajo.Estado == "levantar") {
		return nil, false
	}
	trabajo = &Trabajo{ID: hex.EncodeToString(azar(8)), Tipo: tipo, Estado: "esperando", Paso: 1, Pasos: pasos, Mensaje: "Apoyá el dedo en el lector", cancel: make(chan struct{})}
	return trabajo, true
}

func poner(t *Trabajo, f func(*Trabajo)) { mu.Lock(); f(t); mu.Unlock() }

func luz(ok bool) {
	if z, es := lector.(interface{ Luz(bool) }); es {
		z.Luz(ok)
	}
}

func errTxt(err error) string {
	switch err {
	case ErrSinDedo:
		return "No se apoyó ningún dedo a tiempo. Probá de nuevo."
	case ErrCancelado:
		return "Cancelado."
	case ErrSinLector:
		return "No se encuentra el lector: revisá que esté enchufado."
	case ErrSinSDK:
		return "Falta el software de ZKTeco (ZKFinger SDK / driver) en esta PC."
	case ErrFusion:
		return "Las tres lecturas no coinciden lo suficiente. Probá de nuevo apoyando el dedo entero, siempre el mismo."
	}
	return "Error del lector: " + err.Error()
}

func enrolar(t *Trabajo, ref, dedo string) {
	var caps [][]byte
	reintentos := 0
	for i := 1; i <= 3; i++ {
		poner(t, func(t *Trabajo) {
			t.Estado = "esperando"
			t.Paso = i
			t.Mensaje = fmt.Sprintf("Apoyá el dedo (%d de 3)", i)
		})
		c, err := lector.Capturar(t.cancel)
		if err != nil {
			luz(false)
			poner(t, func(t *Trabajo) {
				t.Estado = map[bool]string{true: "cancelado", false: "error"}[err == ErrCancelado]
				t.Mensaje = errTxt(err)
			})
			return
		}
		if i > 1 && lector.Comparar(caps[0], c) <= 0 {
			luz(false)
			if reintentos++; reintentos > 5 {
				poner(t, func(t *Trabajo) { t.Estado = "error"; t.Mensaje = errTxt(ErrFusion) })
				return
			}
			poner(t, func(t *Trabajo) { t.Mensaje = "Esa lectura no coincide con la primera: apoyá el mismo dedo." })
			i--
			time.Sleep(800 * time.Millisecond)
			continue
		}
		caps = append(caps, c)
		luz(true)
		if i < 3 {
			poner(t, func(t *Trabajo) { t.Estado = "levantar"; t.Mensaje = "Levantá el dedo" })
			time.Sleep(900 * time.Millisecond)
		}
	}
	reg, err := lector.Fusionar(caps[0], caps[1], caps[2])
	if err != nil {
		poner(t, func(t *Trabajo) { t.Estado = "error"; t.Mensaje = errTxt(err) })
		return
	}
	// ¿ya está registrada en otro legajo?
	if fid, _, err := lector.Identificar(reg); err == nil {
		mu.Lock()
		otro := ""
		for r, p := range plant {
			if p.Fid == fid && r != ref {
				otro = r
			}
		}
		mu.Unlock()
		if otro != "" {
			poner(t, func(t *Trabajo) {
				t.Estado = "error"
				t.Mensaje = "Esa huella ya está registrada en otro legajo."
				t.Resultado = map[string]interface{}{"codigo": "huella_de_otro", "ref": otro}
			})
			return
		}
	}
	h := sha256.Sum256(reg)
	mu.Lock()
	var fid uint32 = 1
	if p, ok := plant[ref]; ok {
		fid = p.Fid
		lector.Quitar(fid)
	} else {
		for _, p := range plant {
			if p.Fid >= fid {
				fid = p.Fid + 1
			}
		}
	}
	p := &Plantilla{Fid: fid, Tpl: base64.StdEncoding.EncodeToString(reg), Hash: hex.EncodeToString(h[:]), Dedo: dedo, Ts: time.Now().UTC().Format(time.RFC3339)}
	plant[ref] = p
	err = guardarPlantillas()
	mu.Unlock()
	if err == nil {
		err = lector.Cargar(fid, reg)
	}
	if err != nil {
		poner(t, func(t *Trabajo) {
			t.Estado = "error"
			t.Mensaje = "No se pudo guardar la huella en esta PC: " + err.Error()
		})
		return
	}
	poner(t, func(t *Trabajo) {
		t.Estado = "listo"
		t.Mensaje = "Huella registrada"
		t.Resultado = map[string]interface{}{"ref": ref, "hash": p.Hash, "dedo": dedo, "equipo": cfg.Equipo, "ts": p.Ts}
	})
}

func identificar(t *Trabajo) {
	c, err := lector.Capturar(t.cancel)
	if err != nil {
		poner(t, func(t *Trabajo) {
			t.Estado = map[bool]string{true: "cancelado", false: "error"}[err == ErrCancelado]
			t.Mensaje = errTxt(err)
		})
		return
	}
	fid, score, err := lector.Identificar(c)
	for i := range c {
		c[i] = 0
	}
	ref := ""
	var p *Plantilla
	if err == nil && score >= cfg.MinScore {
		mu.Lock()
		for r, x := range plant {
			if x.Fid == fid {
				ref, p = r, x
			}
		}
		mu.Unlock()
	}
	if ref == "" {
		luz(false)
		poner(t, func(t *Trabajo) {
			t.Estado = "listo"
			t.Mensaje = "No se encontró esa huella en esta PC"
			t.Resultado = map[string]interface{}{"ok": false, "codigo": "sin_coincidencia"}
		})
		return
	}
	luz(true)
	poner(t, func(t *Trabajo) {
		t.Estado = "listo"
		t.Mensaje = "Huella reconocida"
		t.Resultado = map[string]interface{}{"ok": true, "ref": ref, "hash": p.Hash, "score": score, "equipo": cfg.Equipo}
	})
}

func manejar(w http.ResponseWriter, r *http.Request) {
	o := r.Header.Get("Origin")
	if o != "" && !origenOk(o) {
		http.Error(w, "origen no permitido", http.StatusForbidden)
		return
	}
	if o != "" {
		w.Header().Set("Access-Control-Allow-Origin", o)
		w.Header().Set("Vary", "Origin")
		w.Header().Set("Access-Control-Expose-Headers", "X-VB-Firma")
	}
	if r.Method == http.MethodOptions {
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-VB-Ts, X-VB-Nonce, X-VB-Firma")
		w.Header().Set("Access-Control-Allow-Private-Network", "true")
		w.Header().Set("Access-Control-Max-Age", "600")
		w.WriteHeader(http.StatusNoContent)
		return
	}
	// sin Origin sólo se contesta el estado (para que el técnico pueda probar en http://127.0.0.1:52181/estado)
	if o == "" && r.URL.Path != "/estado" {
		http.Error(w, "falta el origen", http.StatusForbidden)
		return
	}
	cuerpo, err := io.ReadAll(io.LimitReader(r.Body, 8192))
	if err != nil {
		http.Error(w, "cuerpo", http.StatusBadRequest)
		return
	}
	switch r.URL.Path {
	case "/estado":
		lector.Reconectar()
		responder(w, "", 200, estadoPublico())
		return
	case "/emparejar/iniciar":
		if r.Method != http.MethodPost {
			break
		}
		mu.Lock()
		n, _ := rand.Int(rand.Reader, big.NewInt(900000))
		codigo, codigoVto, intentos = strconv.Itoa(int(n.Int64())+100000), time.Now().Add(5*time.Minute), 0
		c := codigo
		mu.Unlock()
		avisar("Sistema VB ONG · Lector de huellas", "Código para emparejar este lector con el sistema:\n\n        "+c+"\n\nEscribilo en el sistema (vence en 5 minutos). Si no lo pediste vos, cerrá esta ventana.")
		responder(w, "", 200, map[string]interface{}{"ok": true, "mensaje": "El código apareció en una ventana de esta PC."})
		return
	case "/emparejar/confirmar":
		if r.Method != http.MethodPost {
			break
		}
		var q struct{ Codigo string }
		json.Unmarshal(cuerpo, &q)
		mu.Lock()
		ok := codigo != "" && time.Now().Before(codigoVto) && intentos < 5 && subtle.ConstantTimeCompare([]byte(q.Codigo), []byte(codigo)) == 1
		intentos++
		if !ok {
			if intentos >= 5 {
				codigo = ""
			}
			mu.Unlock()
			responder(w, "", 403, map[string]interface{}{"ok": false, "error": "Código incorrecto o vencido."})
			return
		}
		codigo = ""
		clave = azar(32)
		e, err := proteger(clave)
		if err == nil {
			err = os.WriteFile(dir("clave.bin"), e, 0o600)
		}
		mu.Unlock()
		if err != nil {
			responder(w, "", 500, map[string]interface{}{"ok": false, "error": "No se pudo guardar el emparejamiento."})
			return
		}
		log.Println("emparejado con", o)
		responder(w, "", 200, map[string]interface{}{"ok": true, "clave": base64.StdEncoding.EncodeToString(clave), "equipo": cfg.Equipo})
		return
	}
	// a partir de acá, todo firmado
	nonce, ok := verificar(r, cuerpo)
	if !ok {
		responder(w, "", 401, map[string]interface{}{"ok": false, "error": "no_emparejado", "mensaje": "El lector no está emparejado con este navegador (o la hora de la PC está mal)."})
		return
	}
	var q struct {
		Ref  string `json:"ref"`
		Dedo string `json:"dedo"`
		ID   string `json:"id"`
	}
	json.Unmarshal(cuerpo, &q)
	switch r.URL.Path {
	case "/verificar":
		responder(w, nonce, 200, estadoPublico())
	case "/enrolar":
		if !reRef.MatchString(q.Ref) {
			responder(w, nonce, 400, map[string]interface{}{"ok": false, "error": "referencia inválida"})
			return
		}
		if len(q.Dedo) > 40 {
			q.Dedo = q.Dedo[:40]
		}
		t, ok := nuevoTrabajo("enrolar", 3)
		if !ok {
			responder(w, nonce, 409, map[string]interface{}{"ok": false, "error": "El lector está ocupado con otra lectura."})
			return
		}
		go enrolar(t, q.Ref, q.Dedo)
		responder(w, nonce, 200, map[string]interface{}{"ok": true, "trabajo": t.ID})
	case "/identificar":
		t, ok := nuevoTrabajo("identificar", 1)
		if !ok {
			responder(w, nonce, 409, map[string]interface{}{"ok": false, "error": "El lector está ocupado con otra lectura."})
			return
		}
		go identificar(t)
		responder(w, nonce, 200, map[string]interface{}{"ok": true, "trabajo": t.ID})
	case "/trabajo":
		mu.Lock()
		var c Trabajo
		hay := trabajo != nil && trabajo.ID == q.ID
		if hay {
			c = *trabajo
		}
		mu.Unlock()
		if !hay {
			responder(w, nonce, 404, map[string]interface{}{"ok": false, "error": "trabajo inexistente"})
			return
		}
		responder(w, nonce, 200, map[string]interface{}{"ok": true, "id": c.ID, "tipo": c.Tipo, "estado": c.Estado, "paso": c.Paso, "pasos": c.Pasos, "mensaje": c.Mensaje, "resultado": c.Resultado})
	case "/cancelar":
		mu.Lock()
		if trabajo != nil && (trabajo.Estado == "esperando" || trabajo.Estado == "levantar") {
			close(trabajo.cancel)
			trabajo.Estado = "cancelado"
		}
		mu.Unlock()
		responder(w, nonce, 200, map[string]interface{}{"ok": true})
	case "/borrar":
		if !reRef.MatchString(q.Ref) {
			responder(w, nonce, 400, map[string]interface{}{"ok": false, "error": "referencia inválida"})
			return
		}
		mu.Lock()
		p, hay := plant[q.Ref]
		if hay {
			delete(plant, q.Ref)
			lector.Quitar(p.Fid)
		}
		err := guardarPlantillas()
		mu.Unlock()
		if err != nil {
			responder(w, nonce, 500, map[string]interface{}{"ok": false, "error": "No se pudo guardar."})
			return
		}
		responder(w, nonce, 200, map[string]interface{}{"ok": true, "borrada": hay})
	case "/registradas":
		mu.Lock()
		l := map[string]string{}
		for r, p := range plant {
			l[r] = p.Hash
		}
		mu.Unlock()
		responder(w, nonce, 200, map[string]interface{}{"ok": true, "refs": l})
	case "/sim/dedo":
		if sim == nil {
			http.NotFound(w, r)
			return
		}
		sim.PonerDedo(q.Dedo)
		responder(w, nonce, 200, map[string]interface{}{"ok": true})
	default:
		http.NotFound(w, r)
	}
}

func main() {
	simular := flag.Bool("simular", false, "lector SIMULADO para pruebas automáticas (nunca con personas reales)")
	instalar := flag.Bool("instalar", false, "copiar a la carpeta del usuario e iniciar con Windows")
	desinstalar := flag.Bool("desinstalar", false, "quitar el inicio automático (no borra las huellas)")
	olvidar := flag.Bool("borrar-todo", false, "borrar el emparejamiento y TODAS las huellas guardadas en esta PC")
	silencioso := flag.Bool("silencioso", false, "no mostrar el aviso de inicio (lo usa el inicio automático)")
	origen := flag.String("origen", "", "agregar un origen permitido (p. ej. http://127.0.0.1:8000 para pruebas)")
	flag.Parse()
	os.MkdirAll(carpetaDatos(), 0o700)
	lf, _ := os.OpenFile(dir("agente.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if lf != nil {
		log.SetOutput(io.MultiWriter(os.Stdout, lf))
	}
	if *desinstalar {
		fmt.Println(inicioAutomatico(false))
		return
	}
	if *olvidar {
		os.Remove(dir("clave.bin"))
		os.Remove(dir("plantillas.bin"))
		fmt.Println("Listo: se borraron el emparejamiento y las huellas de esta PC.")
		return
	}
	if *simular {
		sim = nuevoSim()
		lector = sim
	} else {
		lector = nuevoLector()
	}
	cargar()
	if *origen != "" && !origenOk(*origen) {
		cfg.Origenes = append(cfg.Origenes, *origen)
		guardarCfg()
	}
	if *instalar {
		if err := inicioAutomatico(true); err != nil {
			avisar("Sistema VB ONG · Lector de huellas", "No se pudo activar el inicio automático: "+err.Error())
		} else {
			avisar("Sistema VB ONG · Lector de huellas", "Listo. El agente del lector arranca solo con Windows.\nAhora entrá al sistema → Periféricos → Lector de huellas → Emparejar.")
		}
	}
	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", cfg.Puerto))
	if err != nil {
		avisar("Sistema VB ONG · Lector de huellas", "El agente ya está abierto o el puerto "+strconv.Itoa(cfg.Puerto)+" está ocupado.")
		log.Fatal(err)
	}
	go func() { // reconexión: al enchufar o desenchufar el lector
		for {
			time.Sleep(5 * time.Second)
			lector.Reconectar()
		}
	}()
	if !*silencioso && !*instalar && !*simular {
		avisar("Sistema VB ONG · Lector de huellas", "El agente del lector está funcionando.\nLector: "+map[bool]string{true: "conectado", false: "no se detecta (enchufalo o instalá el software de ZKTeco)"}[lector.Conectado()]+"\n\nPara que arranque solo con Windows, ejecutá «Instalar agente de huellas.cmd».")
	}
	log.Printf("Agente de huellas %s · %s · lector: %s (SDK %v, conectado %v) · escuchando en 127.0.0.1:%d · orígenes %v",
		version, cfg.Equipo, lector.Nombre(), lector.SDK(), lector.Conectado(), cfg.Puerto, cfg.Origenes)
	srv := &http.Server{Handler: http.HandlerFunc(manejar), ReadTimeout: 10 * time.Second, WriteTimeout: 30 * time.Second, MaxHeaderBytes: 8192}
	log.Fatal(srv.Serve(ln))
}

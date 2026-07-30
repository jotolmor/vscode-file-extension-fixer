# Registro de cambios

Este proyecto sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y [SemVer](https://semver.org/lang/es/).

## [1.0.0] - 2026-07-29

Primera versión pública. Sin cambios funcionales respecto a la 0.5.0: los tres caminos de detección, la elección de lenguaje por carpeta y el comando manual se consideran estables.

## [0.5.0] - 2026-07-29

### Añadido

- **Pregunta el lenguaje al crear una carpeta vacía**, aunque la detección automática sepa deducirlo: un `QuickPick` con los lenguajes soportados, la opción detectada primera y una entrada *Detectar automáticamente*. Si la carpeta ya hereda una respuesta explícita de un ancestro, no pregunta.
- **Pregunta al iniciar un proyecto** cuando la carpeta abierta no tiene ninguna respuesta guardada y no se puede deducir el lenguaje.
- Ajuste `fileExtensionFixer.folderLanguages`, guardado en el `.vscode/settings.json` del proyecto. Mapa de ruta relativa a extensión, con `.` para la raíz y `auto` para volver a la detección automática. Visible, editable a mano y viaja con el repositorio.
- La elección guardada de una carpeta, o del ancestro más cercano que tenga una, **gana sobre los marcadores y sobre la frecuencia de extensiones**.
- Comando **Set Folder Language** para fijar o corregir la elección de la carpeta del archivo activo en cualquier momento.
- `test/folder-language.test.js`: clave de ruta, herencia por ancestro, escritura en el ámbito `WorkspaceFolder`, y las preguntas al crear carpetas.

## [0.4.1] - 2026-07-29

En un curso de C organizado en una carpeta por ejercicio, un archivo nuevo recibía `.pdb` o `.json` en lugar de `.c`.

### Corregido

- **Los artefactos de MSVC contaban como fuentes.** Compilar en Windows deja `.exe`, `.obj`, `.pdb` e `.ilk` junto al único `.c`; al contar `.pdb` e `.ilk` como código, el empate impedía decidir. Se añaden a la lista de artefactos ignorados, junto con `.lib`, `.exp`, `.idb`, `.pch`, `.gch`, `.su`, `.out`, `.bin`, `.elf`, `.dylib` y `.jar`.
- **`.vscode` aportaba pruebas.** Al fallar todo lo demás, sus `tasks.json` y `launch.json` hacían ganar a `.json`. Se ignoran también `.vs`, `.idea`, `.settings`, `.gradle`, `.cache`, `.pytest_cache`, `.mypy_cache` y las carpetas de salida `Debug`, `Release`, `x64`, `cmake-build-debug` y `cmake-build-release`.

### Cambiado

- El barrido de subcarpetas pasa de un nivel a **dos**, con un tope de 48 lecturas de directorio por nivel. Cubre los árboles de curso, donde los fuentes están en `capitulo/ejercicio/` respecto a la raíz.

## [0.4.0] - 2026-07-29

Un proyecto en C no recibía ninguna extensión. La causa no era C: eran tres carencias del mecanismo de detección que C destapa a la vez, y las tres se han corregido de forma general, para todos los lenguajes.

### Corregido

- **Los archivos acompañantes ya no compiten con los fuentes.** Un proyecto en C tiene tantos `.h` como `.c`, y al contarlos en el mismo grupo el empate anulaba la decisión. `.h`, `.hpp`, `.hh`, `.hxx`, `.inc` y `.pyi` pasan a un grupo secundario, por debajo de los fuentes. Lo mismo resuelve `.cpp` frente a `.hpp` y `.py` frente a `.pyi`.
- **La documentación ya no gana antes de tiempo.** En una raíz con `Makefile` y `README.md` la respuesta era `.md`.
- **Se miran las subcarpetas inmediatas.** Antes, crear un archivo en la raíz de un proyecto cuyos fuentes viven en `src/` no encontraba ninguna prueba.

### Añadido

- Marcadores de la familia C/C++: `Makefile`, `makefile`, `GNUmakefile`, `CMakeLists.txt`, `meson.build`, `configure.ac` y `Kbuild`. Identifican la familia pero no el lenguaje, así que la elección entre `.c` y `.cpp` se resuelve con los fuentes encontrados alrededor; un proyecto recién creado sin fuentes asume `.c`.
- Los artefactos de compilación (`.o`, `.obj`, `.a`, `.so`, `.dll`, `.exe`, `.class`, `.pyc`) dejan de contar como pruebas.
- `test/project-language.test.js`: 28 casos que cubren C, C++ y el resto de lenguajes soportados.

## [0.3.0] - 2026-07-28

### Añadido

- Icono de la extensión, generado de forma reproducible con `npm run icon`.
- Metadatos para el Marketplace: categorías, palabras clave, banner y declaración de capacidades (`untrustedWorkspaces`, `virtualWorkspaces`).
- Suite de pruebas ejecutable con `npm test`: 41 casos que cargan el JavaScript compilado con la API de VS Code simulada.
- Archivo `LICENSE` (MIT).

## [0.2.0] - 2026-07-28

### Añadido

- Detección del lenguaje **del proyecto** al crear un archivo, sin necesidad de escribir contenido: un archivo nuevo sin extensión se renombra según los archivos marcador de la carpeta (`requirements.txt`, `package.json`, `Cargo.toml`…) o, si no hay ninguno, según la extensión más frecuente.
- La búsqueda sube de la carpeta del archivo hacia la raíz del workspace, de modo que en un monorepo gana la carpeta más cercana.
- Renombrado automático sin confirmación previa, con botón **Deshacer** en el aviso.
- Lista de nombres protegidos (`README`, `LICENSE`, `Makefile`, `Dockerfile`…) que nunca reciben extensión.
- Cobertura de archivos creados desde la terminal mediante `FileSystemWatcher`, que `onDidCreateFiles` no detecta.

### Corregido

- Las carpetas recién creadas ya no se confunden con archivos; sin esta comprobación, crear un directorio `backend` en un proyecto Python producía `backend.py`.
- Los archivos sonda que crean algunos editores (por ejemplo el `4913` de vim) se descartan gracias a un retardo de 300 ms y a una revalidación de existencia.

## [0.1.1] - 2026-07-28

### Corregido

- Nombres con el separador mal escrito, como `funcion_bool,py`, se reparan a `funcion_bool.py`. En los teclados españoles la tecla decimal del bloque numérico escribe una coma, y ese nombre no contiene ningún punto: `path.extname()` devolvía cadena vacía y VS Code no podía deducir el lenguaje, así que ninguno de los dos caminos existentes se activaba.
- También se colapsa `funcion_bool,py.py` a `funcion_bool.py`.
- La validación del nombre de destino ya no rechaza tildes ni espacios, que son legítimos; sigue rechazando `..`, separadores de ruta, caracteres de control y los reservados de Windows.

## [0.1.0] - 2026-07-28

### Añadido

- Detección del `languageId` al abrir un archivo sin extensión, con confirmación antes de renombrar.
- Comando manual **Fix File Extension**.
- Renombrado mediante `vscode.workspace.fs.rename`, compatible con WSL, Remote SSH y Dev Containers.
- Canal de salida **File Extension Fixer** con el registro de cada decisión.

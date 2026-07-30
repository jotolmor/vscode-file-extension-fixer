# File Extension Fixer

**[English](#english) · [Español](#español)**

Gives your extensionless files the right extension — from the project's language, from the file's content, or by repairing a mistyped separator.

---

# English

## What it does

You create a file called `test` from the terminal or the explorer. VS Code may guess the language from its content, but on disk it is still `test`. That breaks linters, formatters, build tools and syntax highlighting the next time you open the project.

This extension works through three separate paths:

| Situation | How the extension is decided | Does it ask? |
| --- | --- | --- |
| You create a **new** file with no extension | The **project's** language | No — it renames and offers *Undo* |
| You open an **existing** file with no extension | `languageId` inferred from the content | Yes |
| The name has a comma instead of a dot | The name itself | Yes |

The first path is the important one: **you do not have to type anything inside the file**. Create `test` in a Python project and it becomes `test.py` immediately.

Every decision is written to the **File Extension Fixer** output channel (*View → Output*, then pick it in the dropdown), including the decisions to do nothing.

## It asks you which language when you start

When you **create an empty folder**, the extension asks which language you will use in it, even when it could work it out on its own. A picker appears with the supported languages, the detected one first, plus a **Detect automatically** entry so it stops asking for that folder.

It also asks **when you open a project** whose folder has no stored answer and where nothing can be inferred.

It does not ask when the folder already inherits an explicit answer from an ancestor: if you answered `.c` for the root of your course, every new exercise inherits `.c` without bothering you again.

Pressing Escape stores nothing and does not ask again during that session.

The answer is stored in the project's own `.vscode/settings.json`:

```json
{
  "fileExtensionFixer.folderLanguages": {
    ".": ".c",
    "02-Variables/python_exercise": ".py"
  }
}
```

The key is the path relative to the workspace root, using `/`; `.` is the root. The value is the extension with its dot, or `auto` to fall back to automatic detection. You can edit it by hand, and it travels with the repository.

**A stored answer beats automatic detection.** The folder's own answer is used, or the nearest ancestor that has one. That is how `02-Variables/python_exercise` stays Python inside a course written in C.

To set or correct the choice without editing the JSON: `Ctrl+Shift+P` → **Set Folder Language**, which acts on the folder of the open file.

## The project's language

When no answer is stored, the extension infers the **project's** language. It walks from the folder where you create the file up to the workspace root and, at each level, makes two passes.

### 1. Marker files

They always win when present:

| Marker in the folder | Extension |
| --- | --- |
| `Cargo.toml` | `.rs` |
| `go.mod` | `.go` |
| `Package.swift` | `.swift` |
| `pom.xml`, `build.gradle`, `build.gradle.kts` | `.java` |
| `composer.json` | `.php` |
| `Gemfile` | `.rb` |
| `*.csproj`, `*.sln` | `.cs` |
| `requirements.txt`, `pyproject.toml`, `Pipfile`, `setup.py` | `.py` |
| `package.json` + `tsconfig.json` | `.ts` |
| `package.json` alone | `.js` |
| `Makefile`, `CMakeLists.txt`, `meson.build`, `configure.ac`, `Kbuild` | `.c` or `.cpp` |

Order matters: `package.json` is checked last because it turns up incidentally in projects written in other languages (tooling, linters, documentation sites), whereas `Cargo.toml` or `go.mod` never do.

The C/C++ build files identify the family but not the language, so the choice between `.c` and `.cpp` comes from the sources found nearby: any `.cpp`, `.cc`, `.cxx`, `.hpp`, `.hh` or `.hxx` means C++; with no sources yet, `.c` is assumed.

### 2. Extension frequency

Used when the level has no marker. Files fall into three groups, and only the strongest non-empty group is consulted:

| Group | Examples | When it decides |
| --- | --- | --- |
| Sources | `.c`, `.py`, `.rs`, `.sh` | Whenever there is at least one |
| Companions | `.h`, `.hpp`, `.hh`, `.hxx`, `.inc`, `.pyi` | Only when there are no sources |
| Configuration and documentation | `.json`, `.md`, `.txt`, `.yml`, `.lock` | Only when there is nothing else |

Separating the companions is what makes C work: a project holds as many `.h` files as `.c` files, and counting them together produced a permanent tie that decided nothing.

**Build output never counts**: `.o`, `.obj`, `.a`, `.so`, `.dll`, `.dylib`, `.exe`, `.out`, `.bin`, `.elf`, `.lib`, `.exp`, `.pdb`, `.ilk`, `.idb`, `.pch`, `.gch`, `.su`, `.class`, `.jar`, `.pyc`, `.pyo` and `.map`. Compiling a C program on Windows leaves `.exe`, `.obj`, `.pdb` and `.ilk` next to a single `.c`; counting those blocked every answer.

A tie inside the chosen group makes the level ambiguous, and the walk continues to the parent.

**Subfolders are swept too, two levels deep**, capped at 48 directory reads per level. Without that, creating a file at the root of a project whose sources live in `src/`, or in a course laid out as `02-Variables/my_exercise/`, would find no evidence at all.

Ignored: `node_modules`, `.git`, `out`, `dist`, `build`, `bin`, `obj`, `target`, `vendor`, `venv`, `.venv`, `__pycache__`, `.next`, `.nuxt`, `coverage`, the tooling folders (`.vscode`, `.vs`, `.idea`, `.settings`, `.gradle`, `.cache`, `.pytest_cache`, `.mypy_cache`) and the compiler output folders (`Debug`, `Release`, `x64`, `cmake-build-debug`, `cmake-build-release`).

**Why it walks upwards:** in a monorepo with `package.json` at the root and `requirements.txt` in `backend/`, creating `backend/utils/new` gives `new.py`, not `new.ts`. The nearest folder that can answer always wins.

### Files that are never touched

Renaming without asking demands a list of exceptions. These names are left alone even without an extension:

`README`, `LICENSE`, `LICENCE`, `COPYING`, `CHANGELOG`, `CONTRIBUTING`, `AUTHORS`, `NOTICE`, `VERSION`, `INSTALL`, `TODO`, `Makefile`, `Dockerfile`, `Containerfile`, `Procfile`, `CODEOWNERS`, `Jenkinsfile`, `Vagrantfile`, `Brewfile`, `Gemfile`, `Rakefile`

Without this list, creating a `README` in a Python project would leave you a `README.py`.

Folders are not touched either (creating a directory `backend` does not produce `backend.py`), nor are dotfiles, nor anything inside the ignored folders.

### Undo

Since nothing is confirmed beforehand, every automatic rename shows a notification with an **Undo** button that restores the original name. That is the safety net replacing the dialog.

## Special case: comma instead of dot

On Spanish keyboard layouts the numeric keypad's decimal key types `,`, not `.`. The result is a file called `funcion_bool,py` instead of `funcion_bool.py`. That name contains no dot at all, so:

- `path.extname()` returns an empty string, and the file looks like it has no extension;
- VS Code cannot infer the language from the name either, so it usually reports `plaintext`.

That is why the separator repair is checked **before** the `languageId` detection: the intent is already in the name.

| Current name | Proposal |
| --- | --- |
| `funcion_bool,py` | `funcion_bool.py` |
| `funcion_bool,py.py` | `funcion_bool.py` |
| `datos,csv` | `datos.csv` |
| `report,final` | *(unchanged: `final` is not a known extension)* |
| `notes,v2.md` | *(unchanged: it already has a valid extension)* |

`;` is accepted as a mistyped separator too, given how close the keys are.

The `KNOWN_EXTENSIONS` whitelist is what stops `report,final` from becoming `report.final`: the separator is only repaired when what follows it is a recognised extension.

## What it does not do

- It does not read the file's content: it only uses the `languageId` VS Code provides.
- It never overwrites an existing file.
- It never touches files outside the active workspace.
- It runs no shell commands and sends no data anywhere.
- It does not rename unsaved (`untitled`) documents, nor files with pending changes.

## Installation

Search for **File Extension Fixer** in the Extensions panel (`Ctrl+Shift+X`) and press *Install*. Or from the terminal:

```bash
code --install-extension jorgetoledomoreno.file-extension-fixer
```

From a `.vsix` file:

```bash
code --install-extension file-extension-fixer-1.0.0.vsix
```

Reload afterwards with `Ctrl+Shift+P` → **Developer: Reload Window**.

## Supported languages

| languageId | Extension |
| --- | --- |
| `typescript` | `.ts` |
| `typescriptreact` | `.tsx` |
| `javascript` | `.js` |
| `javascriptreact` | `.jsx` |
| `python` | `.py` |
| `php` | `.php` |
| `java` | `.java` |
| `csharp` | `.cs` |
| `cpp` | `.cpp` |
| `c` | `.c` |
| `html` | `.html` |
| `css` | `.css` |
| `scss` | `.scss` |
| `less` | `.less` |
| `json` | `.json` |
| `jsonc` | `.json` |
| `yaml` | `.yml` |
| `markdown` | `.md` |
| `shellscript` | `.sh` |
| `powershell` | `.ps1` |
| `sql` | `.sql` |
| `rust` | `.rs` |
| `go` | `.go` |
| `ruby` | `.rb` |
| `swift` | `.swift` |
| `kotlin` | `.kt` |
| `xml` | `.xml` |
| `lua` | `.lua` |
| `perl` | `.pl` |
| `r` | `.r` |
| `vue` | `.vue` |
| `ini` | `.ini` |
| `toml` | `.toml` |
| `dockerfile` | *(special case: renamed to `Dockerfile`, no extension)* |
| `plaintext` | *(deliberately ignored)* |

`plaintext` is what VS Code assigns when it fails to identify the language, so acting on it would rename arbitrary files to `.txt`. The same goes for `log`, `binary` and `code-text-binary`.

## Building from source

Requires VS Code 1.85.0 or newer, Node.js 18 or newer, and npm 9 or newer. There are no runtime dependencies.

```bash
npm install
```

```bash
npm run compile
```

Press **F5** to open the `[Extension Development Host]` window with the extension loaded.

Other scripts:

```bash
npm run watch
```

```bash
npm test
```

```bash
npm run icon
```

`npm test` compiles and runs 87 cases across five files in `test/`. No dependencies, no framework: each test loads the already compiled JavaScript from `out/` with the `vscode` module replaced by a double, so the real artifact is verified rather than a copy of the logic.

| File | What it covers |
| --- | --- |
| `test/file-names.test.js` | Separator repair: 15 cases, positive and negative |
| `test/project-language.test.js` | Language detection: 33 cases across C, C++ and every other supported language |
| `test/folder-language.test.js` | Per-folder choice: path key, inheritance, writing, the pickers |
| `test/open-path.test.js` | Opening documents: 10 scenarios |
| `test/create-path.test.js` | Creating files: 16 scenarios over a simulated monorepo |

`images/icon.png` is generated by `npm run icon`. `tools/make-icon.js` draws it as a pure PNG with Node's built-in modules (`zlib` for the deflate, its own CRC32) using 4×4 supersampling for the edges.

## Adding a language

1. Find the exact `languageId`: open a file of that type, then `Ctrl+Shift+P` → **Change Language Mode** → **Configure File Association for...**; the identifier appears in parentheses. The output channel also reports it: `Skipped: language 'X' is not present in LANGUAGE_EXTENSION_MAP.`
2. Add the entry to `LANGUAGE_EXTENSION_MAP` in `src/extension.ts`:

   ```ts
   const LANGUAGE_EXTENSION_MAP: Readonly<Record<string, string>> = {
       // ...existing entries
       elixir: '.ex',
       dart: '.dart'
   };
   ```

3. Run `npm run compile` and reload the development window with `Ctrl+R`.

The value must start with a dot and contain only alphanumeric characters and dots. This is validated at runtime by `isSafeExtension()`, which rejects anything containing `..`, `/` or `\`.

`KNOWN_EXTENSIONS`, used by the separator repair, is built from the values of `LANGUAGE_EXTENSION_MAP`, so adding a language also enables its extension there.

## Troubleshooting

**A new file gets no extension.** Check the output channel:

- `could not determine the project language` — the folder has no markers and its extensions tie or are all configuration. Create the file in a subfolder that holds sources, or add the language's manifest.
- `is a conventional extensionless file` — the name is on the protected list.
- `already exists` — a file with the target name is already there.
- Nothing at all — the file is outside the open folder, or inside an ignored one.

**It picks the wrong extension.** Detection runs from the folder towards the root, so the nearest folder with clues wins. Add the language's manifest in that folder, or answer the picker with **Set Folder Language**. The notification always offers **Undo**.

**The notification never appears when opening a file.** Make sure a folder is open — files outside the workspace are skipped for safety. Check the language shown in the status bar: if it says *Plain Text*, VS Code has not recognised the content. The event only fires when the document is opened, so close and reopen it, or run **Fix File Extension**.

**"Save it and run the command again."** The file has unsaved changes. Renaming on disk with a dirty buffer desynchronises the editor, so the extension stops. Save with `Ctrl+S` and retry.

**It never asks about a file twice.** By design: each URI is handled once per session so the extension stays quiet. The manual command ignores that cache.

---

# Español

## ¿Qué hace esta extensión?

Creas un archivo llamado `test` desde la terminal o el explorador. VS Code puede deducir el lenguaje analizando el contenido, pero en disco sigue llamándose `test`. Eso rompe linters, formateadores, herramientas de build y el resaltado de sintaxis al reabrir el proyecto.

La extensión trabaja por tres caminos distintos:

| Situación | Cómo decide la extensión | ¿Pregunta? |
| --- | --- | --- |
| Creas un archivo **nuevo** sin extensión | Lenguaje del **proyecto** | No, renombra y ofrece *Deshacer* |
| Abres un archivo **ya existente** sin extensión | `languageId` deducido del contenido | Sí |
| El nombre tiene una coma en vez del punto | El propio nombre | Sí |

El primer camino es el importante: **no necesita que escribas nada dentro del archivo**. Creas `test` en un proyecto Python y pasa a `test.py` de inmediato.

Cada decisión queda registrada en el canal de salida **File Extension Fixer** (*Ver → Salida*, y elígelo en el desplegable), incluidas las decisiones de no hacer nada.

## Te pregunta el lenguaje al empezar

Cuando **creas una carpeta vacía**, la extensión te pregunta qué lenguaje vas a usar en ella, aunque sepa deducirlo. Aparece un desplegable con los lenguajes soportados, la opción detectada en primer lugar y una entrada **Detectar automáticamente** para no volver a preguntar en esa carpeta.

También pregunta **al abrir un proyecto** cuya carpeta no tiene ninguna respuesta guardada y en la que no se puede deducir nada.

No pregunta cuando la carpeta ya hereda una respuesta explícita de un ancestro: si contestaste `.c` para la raíz del curso, cada ejercicio nuevo hereda `.c` sin volver a molestarte.

Pulsar Escape no guarda nada y no vuelve a preguntar en esa sesión.

La respuesta se guarda en el `.vscode/settings.json` del proyecto:

```json
{
  "fileExtensionFixer.folderLanguages": {
    ".": ".c",
    "02-Variables/ejercicio_python": ".py"
  }
}
```

La clave es la ruta relativa a la raíz del workspace, con `/` como separador; `.` es la raíz. El valor es la extensión con punto, o `auto` para volver a la detección automática. Puedes editarlo a mano, y viaja con el proyecto.

**La respuesta manda sobre la detección automática.** Se usa la de la carpeta, o la del ancestro más cercano que tenga una. Así `02-Variables/ejercicio_python` sigue siendo Python dentro de un curso escrito en C.

Para fijar o corregir la elección sin editar el JSON: `Ctrl+Mayús+P` → **Set Folder Language**, que actúa sobre la carpeta del archivo abierto.

## El lenguaje del proyecto

Cuando no hay respuesta guardada, la extensión deduce el lenguaje del **proyecto**. Sube desde la carpeta donde creas el archivo hasta la raíz del workspace y, en cada nivel, hace dos pasadas.

### 1. Archivos marcador

Mandan siempre si existen:

| Marcador en la carpeta | Extensión |
| --- | --- |
| `Cargo.toml` | `.rs` |
| `go.mod` | `.go` |
| `Package.swift` | `.swift` |
| `pom.xml`, `build.gradle`, `build.gradle.kts` | `.java` |
| `composer.json` | `.php` |
| `Gemfile` | `.rb` |
| `*.csproj`, `*.sln` | `.cs` |
| `requirements.txt`, `pyproject.toml`, `Pipfile`, `setup.py` | `.py` |
| `package.json` + `tsconfig.json` | `.ts` |
| `package.json` solo | `.js` |
| `Makefile`, `CMakeLists.txt`, `meson.build`, `configure.ac`, `Kbuild` | `.c` o `.cpp` |

El orden importa: `package.json` se comprueba el último porque aparece de forma incidental en proyectos escritos en otros lenguajes (herramientas, linters, sitios de documentación), mientras que `Cargo.toml` o `go.mod` nunca lo hacen.

Los archivos de build de la familia C/C++ identifican la familia pero no el lenguaje, así que la elección entre `.c` y `.cpp` se decide con los fuentes que haya alrededor: cualquier `.cpp`, `.cc`, `.cxx`, `.hpp`, `.hh` o `.hxx` significa C++; si no hay fuentes todavía, se asume `.c`.

### 2. Frecuencia de extensiones

Se usa cuando el nivel no tiene marcador. Los archivos se reparten en tres grupos, y solo se consulta el más fuerte que no esté vacío:

| Grupo | Ejemplos | Cuándo decide |
| --- | --- | --- |
| Fuentes | `.c`, `.py`, `.rs`, `.sh` | Siempre que haya alguno |
| Acompañantes | `.h`, `.hpp`, `.hh`, `.hxx`, `.inc`, `.pyi` | Solo si no hay fuentes |
| Configuración y documentación | `.json`, `.md`, `.txt`, `.yml`, `.lock` | Solo si no hay nada más |

Separar los acompañantes es lo que hace funcionar C: un proyecto tiene tantos `.h` como `.c`, y contarlos juntos producía un empate permanente que no decidía nada.

**Los artefactos de compilación no cuentan nunca**: `.o`, `.obj`, `.a`, `.so`, `.dll`, `.dylib`, `.exe`, `.out`, `.bin`, `.elf`, `.lib`, `.exp`, `.pdb`, `.ilk`, `.idb`, `.pch`, `.gch`, `.su`, `.class`, `.jar`, `.pyc`, `.pyo` y `.map`. Compilar un programa en C bajo Windows deja `.exe`, `.obj`, `.pdb` e `.ilk` junto a un único `.c`; contándolos, el empate bloqueaba cualquier respuesta.

Un empate dentro del grupo elegido hace ese nivel ambiguo, y la búsqueda sube al superior.

**Se barren también las subcarpetas, hasta dos niveles**, con un tope de 48 lecturas de directorio por nivel. Sin eso, crear un archivo en la raíz de un proyecto cuyos fuentes viven en `src/`, o en un curso organizado como `02-Variables/mi_ejercicio/`, no encontraría ninguna pista.

Se ignoran `node_modules`, `.git`, `out`, `dist`, `build`, `bin`, `obj`, `target`, `vendor`, `venv`, `.venv`, `__pycache__`, `.next`, `.nuxt`, `coverage`, las carpetas de herramientas (`.vscode`, `.vs`, `.idea`, `.settings`, `.gradle`, `.cache`, `.pytest_cache`, `.mypy_cache`) y las de salida del compilador (`Debug`, `Release`, `x64`, `cmake-build-debug`, `cmake-build-release`).

**Por qué sube nivel a nivel:** en un monorepo con `package.json` en la raíz y `requirements.txt` en `backend/`, crear `backend/utils/nuevo` da `nuevo.py`, no `nuevo.ts`. Gana siempre la carpeta más cercana que sepa responder.

### Archivos que nunca se tocan

Renombrar sin preguntar exige una lista de excepciones. Estos nombres se dejan intactos aunque no tengan extensión:

`README`, `LICENSE`, `LICENCE`, `COPYING`, `CHANGELOG`, `CONTRIBUTING`, `AUTHORS`, `NOTICE`, `VERSION`, `INSTALL`, `TODO`, `Makefile`, `Dockerfile`, `Containerfile`, `Procfile`, `CODEOWNERS`, `Jenkinsfile`, `Vagrantfile`, `Brewfile`, `Gemfile`, `Rakefile`

Sin esta lista, crear un `README` en un proyecto Python te dejaría un `README.py`.

Tampoco se tocan las carpetas (crear un directorio `backend` no produce `backend.py`), ni los archivos que empiezan por punto, ni nada dentro de las carpetas ignoradas.

### Deshacer

Como no hay confirmación previa, cada renombrado automático muestra un aviso con un botón **Deshacer** que devuelve el nombre original. Es la red de seguridad que sustituye al diálogo.

## Caso especial: coma en vez de punto

En los teclados españoles, la tecla decimal del bloque numérico escribe `,`, no `.`. El resultado es un archivo llamado `funcion_bool,py` en lugar de `funcion_bool.py`. Ese nombre no contiene ningún punto, así que:

- `path.extname()` devuelve cadena vacía y el archivo parece no tener extensión;
- VS Code tampoco puede deducir el lenguaje por el nombre, así que suele reportar `plaintext`.

Por eso la reparación del separador se comprueba **antes** que la detección por `languageId`: la intención ya está en el nombre.

| Nombre actual | Propuesta |
| --- | --- |
| `funcion_bool,py` | `funcion_bool.py` |
| `funcion_bool,py.py` | `funcion_bool.py` |
| `datos,csv` | `datos.csv` |
| `informe,final` | *(sin cambios: `final` no es una extensión conocida)* |
| `notas,v2.md` | *(sin cambios: ya tiene extensión válida)* |

También se acepta `;` como separador erróneo, por la cercanía de las teclas.

La lista blanca `KNOWN_EXTENSIONS` es lo que evita que `informe,final` se convierta en `informe.final`: solo se repara el separador cuando el texto que va detrás es una extensión reconocida.

## Lo que la extensión NO hace

- No lee el contenido del archivo: solo usa el `languageId` que proporciona VS Code.
- No sobrescribe archivos existentes.
- No toca archivos fuera del workspace activo.
- No ejecuta comandos de shell ni envía datos a ningún servicio externo.
- No renombra documentos sin guardar (`untitled`) ni archivos con cambios pendientes.

## Instalación

Busca **File Extension Fixer** en el panel de extensiones (`Ctrl+Mayús+X`) y pulsa *Instalar*. O desde la terminal:

```bash
code --install-extension jorgetoledomoreno.file-extension-fixer
```

Desde un archivo `.vsix`:

```bash
code --install-extension file-extension-fixer-1.0.0.vsix
```

Recarga después con `Ctrl+Mayús+P` → **Developer: Reload Window**.

## Lenguajes soportados

| languageId | Extensión |
| --- | --- |
| `typescript` | `.ts` |
| `typescriptreact` | `.tsx` |
| `javascript` | `.js` |
| `javascriptreact` | `.jsx` |
| `python` | `.py` |
| `php` | `.php` |
| `java` | `.java` |
| `csharp` | `.cs` |
| `cpp` | `.cpp` |
| `c` | `.c` |
| `html` | `.html` |
| `css` | `.css` |
| `scss` | `.scss` |
| `less` | `.less` |
| `json` | `.json` |
| `jsonc` | `.json` |
| `yaml` | `.yml` |
| `markdown` | `.md` |
| `shellscript` | `.sh` |
| `powershell` | `.ps1` |
| `sql` | `.sql` |
| `rust` | `.rs` |
| `go` | `.go` |
| `ruby` | `.rb` |
| `swift` | `.swift` |
| `kotlin` | `.kt` |
| `xml` | `.xml` |
| `lua` | `.lua` |
| `perl` | `.pl` |
| `r` | `.r` |
| `vue` | `.vue` |
| `ini` | `.ini` |
| `toml` | `.toml` |
| `dockerfile` | *(caso especial: renombra a `Dockerfile`, sin extensión)* |
| `plaintext` | *(ignorado a propósito)* |

`plaintext` es lo que VS Code asigna cuando no consigue identificar el lenguaje, así que actuar sobre él renombraría archivos arbitrarios a `.txt`. Lo mismo con `log`, `binary` y `code-text-binary`.

## Compilar desde el código

Requiere VS Code 1.85.0 o superior, Node.js 18 o superior y npm 9 o superior. No hay dependencias de runtime.

```bash
npm install
```

```bash
npm run compile
```

Pulsa **F5** para abrir la ventana `[Extension Development Host]` con la extensión cargada.

Otros scripts:

```bash
npm run watch
```

```bash
npm test
```

```bash
npm run icon
```

`npm test` compila y ejecuta 87 casos repartidos en cinco archivos de `test/`. Sin dependencias ni frameworks: cada prueba carga el JavaScript ya compilado de `out/` sustituyendo el módulo `vscode` por un doble, de modo que se verifica el artefacto real y no una copia de la lógica.

| Archivo | Qué cubre |
| --- | --- |
| `test/file-names.test.js` | Reparación del separador: 15 casos, positivos y negativos |
| `test/project-language.test.js` | Detección del lenguaje: 33 casos sobre C, C++ y el resto de lenguajes |
| `test/folder-language.test.js` | Elección por carpeta: clave de ruta, herencia, escritura, los desplegables |
| `test/open-path.test.js` | Apertura de documentos: 10 escenarios |
| `test/create-path.test.js` | Creación de archivos: 16 escenarios sobre un monorepo simulado |

`images/icon.png` se genera con `npm run icon`. `tools/make-icon.js` lo dibuja en PNG puro con los módulos incorporados de Node (`zlib` para el deflate, CRC32 propio), con supersampling 4×4 para los bordes.

## Cómo añadir un lenguaje

1. Averigua el `languageId` exacto: abre un archivo de ese tipo y pulsa `Ctrl+Mayús+P` → **Change Language Mode** → **Configure File Association for...**; el identificador aparece entre paréntesis. El canal de salida también lo indica: `Skipped: language 'X' is not present in LANGUAGE_EXTENSION_MAP.`
2. Añade la entrada a `LANGUAGE_EXTENSION_MAP` en `src/extension.ts`:

   ```ts
   const LANGUAGE_EXTENSION_MAP: Readonly<Record<string, string>> = {
       // ...entradas existentes
       elixir: '.ex',
       dart: '.dart'
   };
   ```

3. Ejecuta `npm run compile` y recarga la ventana de desarrollo con `Ctrl+R`.

El valor debe empezar por punto y contener solo caracteres alfanuméricos y puntos. Se valida en tiempo de ejecución con `isSafeExtension()`, que rechaza cualquier valor con `..`, `/` o `\`.

`KNOWN_EXTENSIONS`, que usa la reparación del separador, se construye a partir de los valores de `LANGUAGE_EXTENSION_MAP`, así que añadir un lenguaje también habilita su extensión allí.

## Solución de problemas

**Creo un archivo nuevo y no le pone extensión.** Mira el canal de salida:

- `could not determine the project language` — la carpeta no tiene marcadores y sus extensiones empatan o son todas de configuración. Crea el archivo en una subcarpeta con fuentes, o añade el manifiesto del lenguaje.
- `is a conventional extensionless file` — el nombre está en la lista de protegidos.
- `already exists` — ya hay un archivo con el nombre de destino.
- No aparece nada: el archivo está fuera de la carpeta abierta, o dentro de una ignorada.

**Le pone la extensión equivocada.** La detección va de la carpeta hacia la raíz, así que manda la carpeta más cercana con pistas. Añade el manifiesto del lenguaje en esa carpeta, o responde el desplegable con **Set Folder Language**. El aviso siempre ofrece **Deshacer**.

**No aparece la notificación al abrir un archivo.** Comprueba que hay una carpeta abierta: los archivos fuera del workspace se ignoran por seguridad. Mira el lenguaje en la barra de estado; si dice *Plain Text*, VS Code no ha reconocido el contenido. El evento solo se dispara al abrir el documento, así que ciérralo y vuelve a abrirlo, o usa **Fix File Extension**.

**"Save it and run the command again."** El archivo tiene cambios sin guardar. Renombrar en disco con el buffer sucio desincroniza el editor, así que la extensión se detiene. Guarda con `Ctrl+S` y repite.

**No vuelve a preguntar por un archivo.** Es intencionado: cada URI se procesa una sola vez por sesión para no ser molesta. El comando manual ignora esa caché.

---

## License / Licencia

MIT © 2026 Jorge Toledo Moreno

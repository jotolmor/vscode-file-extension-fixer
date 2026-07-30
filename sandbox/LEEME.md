# Carpeta de pruebas

Esta carpeta existe solo para probar la extensión. La configuración de depuración
"Run Extension (carpeta de pruebas)" abre esta carpeta directamente en la ventana
[Extension Development Host], de modo que ya hay un workspace activo (requisito
de la extensión: no toca archivos fuera del workspace).

Prueba rápida:

1. Crea aquí un archivo llamado `test`, sin extensión.
2. Pega dentro contenido de Python:

       import os

       def main():
           print(os.getcwd())

3. Guarda (Ctrl+S) y cierra la pestaña.
4. Vuelve a abrir `test` desde el explorador.
5. Aparece la notificación: ¿Renombrar 'test' a 'test.py'?

Nada de lo que haya en esta carpeta se incluye en el paquete .vsix.

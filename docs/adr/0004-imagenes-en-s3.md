# ADR-0004: Las imágenes van a un almacenamiento S3 detrás de `IFileStorage` y las sirve la API

- Estado: aceptado
- Fecha: 2026-11-07

## Contexto

La feature imagenes-portal deja adjuntar a cada pantalla su diseño o captura (PNG, JPEG o WebP, hasta 5 MB). `docs/architecture.md` ya preveía un módulo Files con S3 y MinIO en desarrollo, pero al implementarlo MinIO dejó de publicar imágenes en Docker Hub (`minio/minio` responde "repository does not exist") y `quay.io` no se alcanza desde la nube de desarrollo. Las imágenes son privadas (pueden mostrar flujos internos de un banco), así que no pueden quedar en un bucket público.

## Opciones consideradas

1. **S3 detrás de `IFileStorage`, con RustFS en desarrollo y CI**: el mismo código (SDK de AWS) funciona con AWS S3, R2 o cualquier servidor compatible. RustFS es Apache-2.0 y está en Docker Hub con versión fija. Contras: un servicio más en desarrollo y CI, y RustFS es un proyecto joven.
2. **Bytes en Postgres (`bytea`) detrás de la misma interfaz**: sin servicios extra. Contras: la base crece con archivos, los respaldos pesan más y habría que migrar a S3 al desplegar.
3. **URLs prefirmadas de S3 para que el navegador lea directo**: menos carga en la API. Contras: el almacenamiento tiene que ser alcanzable desde el navegador, y las URLs dan acceso a quien las tenga mientras duren.

## Decisión

Opción 1. El módulo `Walkie.Modules.Files` guarda los datos de cada imagen en `files.assets` y los bytes en S3 (`IFileStorage` → `S3FileStorage`; bucket creado al arrancar). La API sirve la imagen en `GET /api/assets/{id}` con la misma autenticación que el resto (opción 3 descartada). La web la pide con el token y la muestra como `blob:`. El tipo se reconoce por el contenido, nunca por la extensión, y SVG queda fuera.

## Consecuencias

- Positivas: producción usa cualquier S3 cambiando solo la configuración (`Storage__Endpoint`, `Storage__Bucket`, `Storage__AccessKey`, `Storage__SecretKey`). Las imágenes nunca son públicas. Un asset no cambia (reemplazar es subir otro), así que se cachea sin problemas.
- Negativas / costos: RustFS se levanta en docker-compose, en CI (job `e2e`) y en las pruebas de integración (Testcontainers). Todas las lecturas pasan por la API. Las imágenes que ningún lienzo usa quedan guardadas hasta que exista una limpieza.
- Qué habría que hacer para revertirla: otra implementación de `IFileStorage` (ej. Postgres) y una migración de los objetos. Los endpoints y la web no cambian.

# Hearts — Visión, arquitectura y roadmap de evolución

> Documentación de implementación y Fase 0: [`docs/hearts/README.md`](hearts/README.md)
>
> Roadmap de evolución: secciones 8–10 de este documento.

Quiero establecer y alinear el contexto arquitectónico de Hearts dentro de Inteligencia Digna.

Ya conoces parcialmente la implementación actual y tienes acceso al repositorio. Por lo tanto, no necesitas volver a realizar una auditoría general de la aplicación ni explicar tecnologías que ya conoces.

El objetivo de este documento es definir hacia dónde queremos llevar Hearts, qué responsabilidades debe tener cada componente y cómo debemos dividir su evolución en fases entregables.

Este documento establece la visión del producto. Cuando una decisión requiera adaptación al código existente, inspecciona la implementación y propón la solución más coherente.

No implementes todo de inmediato. Primero utiliza este contexto como referencia para las siguientes decisiones de arquitectura y desarrollo.

---

# 1. Visión de Hearts

Hearts debe evolucionar hacia una plataforma de servicios de IA configurables, extensibles y administrables.

No queremos construir una colección de agentes hardcodeados.

Queremos que programadores y administradores puedan crear, configurar, publicar y ampliar Hearts utilizando un sistema común.

Un Heart debe poder especializarse en una función empresarial mediante una definición configurable, sin requerir una implementación exclusiva de código para cada agente.

Ejemplos de Hearts futuros:

- Soporte técnico.
- Recursos Humanos.
- Análisis documental.
- Asistencia a departamentos.
- Consulta de información empresarial.
- Análisis de tickets.
- Preparación de reportes.
- Automatización de procesos.

La plataforma debe permitir que estas capacidades crezcan progresivamente.

La visión a largo plazo incluye características comparables conceptualmente a Gems, Skills, herramientas de OpenCode, MCP y tareas autónomas, pero adaptadas a una plataforma empresarial que prioriza control, seguridad, privacidad y ejecución con modelos locales.

No queremos construir todas estas capacidades desde el principio. Queremos una arquitectura que permita incorporarlas sin rediseñar el núcleo.

---

# 2. Qué es un Heart

Un Heart es una definición configurable de un servicio de IA.

La definición determina:

- Qué función cumple.
- Cómo se comporta.
- Qué instrucciones sigue.
- Qué limitaciones tiene.
- Qué información puede consultar.
- Qué herramientas puede utilizar.
- Qué integraciones tiene disponibles.
- Qué nivel de autonomía posee.
- Quién puede utilizarlo.
- Cómo y cuándo puede ejecutarse.

Un Heart no es el modelo de IA.

Un Heart tampoco debe ser una clase o implementación exclusiva.

Es una configuración que utiliza un motor común para ejecutar una capacidad especializada.

## Heart personal

Un Heart personal pertenece a un usuario.

El usuario puede configurarlo y utilizarlo dentro de los permisos que tenga disponibles.

Por defecto, debe ser privado.

## Heart empresarial

Un Heart empresarial es un servicio administrado por la organización.

Puede estar disponible para todos los usuarios o para áreas y departamentos específicos.

La administración empresarial debe permitir crear, configurar, publicar, actualizar, pausar y revocar Hearts.

Si un departamento necesita un Heart, puede solicitarlo proporcionando una plantilla o requerimiento. El administrador revisa la solicitud y configura el servicio desde el panel administrativo.

La diferencia entre Hearts personales y empresariales debe resolverse principalmente mediante propiedad, visibilidad, publicación y permisos.

Ambos deben utilizar el mismo motor de ejecución.

---

# 3. Arquitectura conceptual

La arquitectura debe separar las siguientes responsabilidades.

## 3.1 Heart Definition

Es la definición persistida del Heart.

Debe contener, según las capacidades habilitadas:

### Identidad

- Nombre.
- Descripción.
- Rol.

### Comportamiento

- Tono.
- Instrucciones.
- Limitaciones.
- Objetivos.

### Modelo

- Modelo local asignado.
- Temperatura.
- Parámetros de inferencia compatibles.

### Conocimiento

- Fuentes de conocimiento autorizadas.
- Bases de conocimiento.
- Documentos o colecciones permitidas.

### Capacidades

- Herramientas autorizadas.
- Skills habilitadas.
- Integraciones disponibles.

### Administración

- Propietario.
- Visibilidad.
- Estado.
- Versión.
- Permisos de uso.

### Autonomía futura

- Tipo de ejecución.
- Eventos.
- Programación.
- Notificaciones.
- Política de aprobación.

La definición debe validarse mediante un esquema tipado.

No debe permitirse que los usuarios introduzcan código arbitrario como parte de la configuración de un Heart.

---

## 3.2 Heart Registry

Es el componente que administra las definiciones de Hearts.

Responsabilidades:

- Crear Hearts.
- Editar configuraciones.
- Duplicar Hearts.
- Eliminar borradores.
- Publicar versiones.
- Administrar visibilidad.
- Administrar propietarios.
- Pausar Hearts.
- Revocar Hearts.
- Consultar versiones e historial.

Debe validar permisos y reglas de negocio.

El Registry no debe ejecutar directamente al modelo.

---

## 3.3 Heart Runtime

Es el motor genérico que ejecuta las definiciones de Hearts.

El Runtime debe permitir que diferentes Hearts se ejecuten utilizando el mismo mecanismo.

Su responsabilidad es coordinar la ejecución.

Flujo conceptual:

1. Recibir una solicitud de ejecución.
2. Cargar la definición del Heart.
3. Validar que el Heart esté activo.
4. Validar que el usuario pueda utilizarlo.
5. Cargar instrucciones y limitaciones.
6. Construir el contexto.
7. Obtener el conocimiento autorizado.
8. Determinar las herramientas disponibles.
9. Invocar el modelo local.
10. Interpretar las solicitudes de herramientas.
11. Delegar las herramientas al Tool Gateway.
12. Continuar la ejecución cuando sea necesario.
13. Aplicar límites de ejecución.
14. Registrar resultados y errores.
15. Entregar la respuesta.

El Runtime no debe contener lógica específica para un Heart individual.

Por ejemplo, el Heart de soporte técnico debe ser una definición ejecutada por el Runtime, no una excepción permanente dentro de su código.

El Runtime debe ser intercambiable en el sentido de que puede ejecutar distintas definiciones sin modificarse.

---

## 3.4 Tool Registry

Es el registro central de herramientas disponibles.

Cada herramienta debe tener un contrato definido.

Conceptualmente:

- Identificador.
- Nombre.
- Descripción.
- Entrada.
- Salida.
- Permisos requeridos.
- Nivel de riesgo.
- Integración asociada.
- Versión.
- Estado.

Las herramientas deben poder registrarse y agregarse de forma modular.

El Runtime debe consultar el registro para conocer qué herramientas puede ofrecer a un Heart.

---

## 3.5 Tool Gateway

Es la frontera de seguridad entre el modelo y las capacidades del sistema.

Todas las solicitudes de herramientas deben pasar por el Gateway.

Debe validar:

- Usuario.
- Heart.
- Estado del Heart.
- Herramienta.
- Permisos.
- Parámetros.
- Integración.
- Alcance de la operación.
- Política de ejecución.

El modelo nunca debe ejecutar directamente una herramienta sin autorización del Gateway.

El Gateway debe rechazar solicitudes no autorizadas aunque el modelo las solicite explícitamente.

---

## 3.6 Integrations Registry

Es el componente que administra las conexiones con sistemas externos.

Ejemplos futuros:

- Google Drive.
- ServiceDesk.
- GitHub.
- Sistemas internos.
- Bases de datos empresariales.
- Otros servicios mediante MCP.

Debe administrar:

- Conexiones.
- Permisos.
- Credenciales.
- Estado.
- Configuración.
- Versiones.
- Operaciones permitidas.

Las credenciales nunca deben exponerse al modelo ni guardarse dentro de las instrucciones del Heart.

---

## 3.7 Skills

Las Skills representan procedimientos o capacidades reutilizables.

Pueden contener:

- Instrucciones.
- Procedimientos.
- Ejemplos.
- Referencias.
- Metodologías.
- Flujos de trabajo.

Una Skill puede enseñar al Heart cómo realizar una tarea.

Sin embargo, una Skill no debe otorgar permisos automáticamente.

Una Skill puede indicar cómo analizar un documento, pero el acceso al documento debe estar autorizado por las herramientas y permisos de la plataforma.

---

## 3.8 MCP

MCP debe considerarse un protocolo de integración extensible.

Su función es facilitar la conexión con herramientas y sistemas externos.

No debe sustituir:

- Heart Runtime.
- Tool Registry.
- Tool Gateway.
- Sistema de permisos.
- Administración de credenciales.

La plataforma debe poder incorporar servidores MCP aprobados sin modificar el núcleo del Runtime.

No debemos permitir la instalación o ejecución automática de servidores MCP no aprobados.

---

## 3.9 Task Engine

Es la futura capa de ejecución persistente.

Debe permitir que un Heart se ejecute:

- Por programación.
- Por eventos.
- Por solicitudes manuales que continúan en segundo plano.
- Como parte de un proceso empresarial.

Debe contar con:

- Cola persistente.
- Worker.
- Reintentos controlados.
- Cancelación.
- Pausa.
- Historial.
- Notificaciones.
- Auditoría.

Las tareas deben sobrevivir a reinicios del servidor.

---

## 3.10 Workflow Engine

Es la capa futura para procesos de varios pasos.

Un Workflow puede coordinar:

- Uno o varios Hearts.
- Herramientas.
- Condiciones.
- Eventos.
- Aprobaciones.
- Acciones externas.
- Notificaciones.

No es necesario construir un motor completo de workflows en el primer MVP.

Pero debemos evitar que el Runtime quede limitado exclusivamente a conversaciones.

---

# 4. Limitaciones y permisos

El formulario actual de Hearts incluye:

- Nombre.
- Rol.
- Tono.
- Instrucciones.
- Limitaciones.
- Temperatura.
- Herramientas.

Esta interfaz es un buen punto de partida.

La sección de limitaciones debe mantenerse como parte de la configuración conductual del Heart.

Ejemplos:

- No inventar información.
- No revelar datos confidenciales.
- No afirmar que se realizó una acción sin confirmación.
- No ejecutar procedimientos fuera de su función.
- Solicitar aclaraciones cuando una petición sea ambigua.

Sin embargo, las limitaciones escritas no son controles técnicos suficientes.

Debemos separar:

### Limitaciones conductuales

Son instrucciones que se envían al modelo.

### Permisos técnicos

Son restricciones que aplica el backend.

Ejemplos:

- No puede eliminar archivos.
- No puede modificar documentos.
- No puede enviar correos.
- No puede acceder a una integración.
- No puede ejecutar herramientas fuera de su alcance.

La seguridad debe depender de permisos técnicos, no exclusivamente de instrucciones.

La configuración de un Heart debe permitir definir capacidades, pero el backend debe validar cada operación.

---

# 5. Pausa y revocación

La plataforma debe permitir detener o retirar la autorización de un Heart.

## Pausa

Un Heart pausado:

- No inicia nuevas ejecuciones.
- No acepta nuevas tareas.
- No ejecuta nuevas llamadas a herramientas.
- Puede conservar tareas pendientes.
- Puede reanudarse posteriormente.

## Revocación

Un Heart revocado pierde la autorización para ejecutarse.

Debe impedir nuevas ejecuciones y nuevas llamadas a herramientas.

La validación debe realizarse:

- Antes de iniciar.
- Antes de cada llamada a herramienta.
- Antes de acciones externas.
- Durante reintentos de tareas.

La pausa y revocación deben diseñarse desde el inicio del Runtime.

No basta con cambiar un estado en la interfaz.

---

# 6. Aislamiento de credenciales

Las integraciones deben tener credenciales administradas por la plataforma.

El Heart no debe recibir tokens, contraseñas ni secretos dentro de su contexto.

Ejemplo:

El Heart solicita una búsqueda en Drive.

El Runtime entrega la solicitud al Tool Gateway.

El Gateway valida permisos.

El conector obtiene la credencial correspondiente y ejecuta la operación.

El resultado autorizado regresa al Runtime.

Las credenciales deben estar aisladas por integración y conexión.

Debemos distinguir:

- Conexiones personales.
- Conexiones empresariales.
- Permisos por operación.
- Alcance por recurso.
- Revocación.
- Rotación.
- Auditoría.

Un Heart empresarial compartido no debe tener automáticamente acceso ilimitado a todas las conexiones de la empresa.

La autorización debe considerar al usuario que ejecuta el Heart y los permisos correspondientes.

---

# 7. Extensibilidad de capacidades

La plataforma debe permitir agregar capacidades mediante diferentes mecanismos.

## Herramientas nativas

Para operaciones centrales y sensibles de Inteligencia Digna.

Ejemplos:

- Búsqueda en la base de conocimiento con ACL.
- Consulta de información del usuario.
- Lectura de archivos autorizados.
- Preparación de escalaciones.
- Consulta de estado de Hearts.

## Skills

Para procedimientos reutilizables.

## MCP

Para conectar herramientas y sistemas externos.

## Plugins y conectores

Para integraciones administradas y empaquetadas.

## Workflows

Para procesos de varios pasos.

## Tasks

Para ejecuciones programadas o persistentes.

La arquitectura debe permitir agregar estas capacidades sin introducir lógica específica de cada Heart dentro del Runtime.

---

# 8. Roadmap de Hearts

Quiero que el desarrollo de Hearts se divida en fases entregables.

No debemos implementar todas las fases de una sola vez.

## Fase 0 — Estabilización

Objetivo:

Asegurar que la implementación actual de Hearts sea estable y segura.

Revisar:

- Autenticación.
- Permisos.
- Propiedad.
- Hearts personales.
- Hearts empresariales.
- Base de conocimiento.
- Auditoría.
- Ejecución actual.

Entregable:

Una base funcional y segura sobre la que evolucionar.

## Fase 1 — Heart Registry

Objetivo:

Convertir Hearts en definiciones configurables persistidas.

Entregables:

- Esquema de Heart.
- Validación.
- CRUD.
- Propiedad.
- Visibilidad.
- Publicación.
- Estados.
- Versionado.

Criterio de aceptación:

Un administrador puede crear un Heart de soporte técnico desde el panel sin escribir código específico para ese Heart.

## Fase 2 — Heart Runtime

Objetivo:

Ejecutar cualquier Heart mediante un motor común.

Entregables:

- Carga de definiciones.
- Construcción de contexto.
- Integración con Ollama.
- Manejo de conversación.
- Solicitudes de herramientas.
- Límites de ejecución.
- Registro de ejecuciones.

Criterio de aceptación:

Crear un segundo Heart con instrucciones y capacidades diferentes sin modificar el Runtime.

## Fase 3 — Tool Registry y Tool Gateway

Objetivo:

Controlar las capacidades que puede ejecutar el modelo.

Entregables:

- Registro de herramientas.
- Contratos tipados.
- Validación.
- Permisos.
- Niveles de riesgo.
- Autorización.
- Auditoría.
- Pausa.
- Revocación.

Criterio de aceptación:

Una herramienta no autorizada es rechazada por backend aunque el modelo intente ejecutarla.

## Fase 4 — Integraciones y extensibilidad

Objetivo:

Agregar capacidades sin modificar el Runtime.

Entregables:

- Integrations Registry.
- Registro de Skills.
- MCP.
- Conectores aprobados.
- Gestión de credenciales.
- Permisos por integración.
- Versionado.

Criterio de aceptación:

Agregar una integración nueva mediante su conector y registro, sin modificar el código central del Runtime.

## Fase 5 — Hearts empresariales

Objetivo:

Convertir Hearts en servicios compartidos.

Entregables:

- Catálogo empresarial.
- Publicación.
- Visibilidad por departamento.
- Permisos de uso.
- Solicitudes de nuevos Hearts.
- Versiones.
- Administración.

Criterio de aceptación:

Un administrador publica un Heart y los usuarios autorizados pueden utilizarlo como servicio.

## Fase 6 — Tasks y notificaciones

Objetivo:

Permitir ejecuciones fuera de una conversación interactiva.

Entregables:

- Tareas programadas.
- Cola persistente.
- Worker.
- Reintentos.
- Notificaciones.
- Historial.
- Cancelación.
- Pausa.

Criterio de aceptación:

Una tarea sobrevive a un reinicio del servidor y puede detenerse desde administración.

## Fase 7 — Workflows y autonomía

Objetivo:

Permitir procesos empresariales de varios pasos.

Entregables:

- Workflows.
- Eventos.
- Condiciones.
- Aprobaciones.
- Acciones externas.
- Observabilidad.
- Compensaciones cuando sean posibles.

Criterio de aceptación:

Un Heart completa un proceso controlado, con permisos y trazabilidad.

## Fase 8 — Ecosistema de capacidades

Objetivo:

Crear un catálogo de extensiones administradas.

Entregables:

- Catálogo de Skills.
- Catálogo de conectores.
- Publicación de extensiones.
- Revisión administrativa.
- Compatibilidad.
- Métricas.
- Evaluación de calidad.

---

# 9. Principios arquitectónicos

Estas decisiones deben orientar el desarrollo:

1. Un Heart es una definición, no una implementación hardcodeada.
2. Todos los Hearts utilizan un Runtime común.
3. El Runtime no contiene lógica específica de Hearts individuales.
4. Las herramientas se registran mediante contratos definidos.
5. Todas las llamadas a herramientas pasan por el Tool Gateway.
6. Las instrucciones no sustituyen los permisos técnicos.
7. Las credenciales nunca se exponen al modelo.
8. Las integraciones deben ser modulares.
9. MCP es un mecanismo de integración, no el núcleo de seguridad.
10. Skills no otorgan permisos automáticamente.
11. Los Hearts personales y empresariales comparten arquitectura.
12. La propiedad y visibilidad se resuelven mediante permisos.
13. Las ejecuciones deben ser auditables.
14. Los Hearts deben poder pausarse y revocarse.
15. La autonomía debe construirse progresivamente.
16. Las tareas persistentes deben tener límites y mecanismos de cancelación.
17. La plataforma debe continuar utilizando modelos locales.
18. No debemos construir abstracciones innecesarias antes de validar su utilidad.

---

# 10. Cómo quiero que trabajemos a partir de este contexto

Utiliza esta visión como referencia para las futuras implementaciones de Hearts.

Cuando te solicite desarrollar una fase:

1. Inspecciona los módulos existentes relacionados con esa fase.
2. Identifica qué podemos reutilizar.
3. Propón los cambios mínimos necesarios.
4. Divide la implementación en entregables pequeños.
5. Implementa únicamente el alcance acordado.
6. Añade pruebas.
7. Verifica que no se rompan funcionalidades existentes.
8. Documenta las decisiones relevantes.

No reescribas Hearts desde cero si podemos evolucionar la implementación actual.

No implementes el roadmap completo en una sola tarea.

Prioriza una arquitectura modular, segura y pragmática.

El primer objetivo técnico de esta evolución es lograr que un Heart configurable pueda ejecutarse mediante un Runtime genérico y utilizar herramientas autorizadas sin depender de lógica hardcodeada.

A partir de esa base podremos construir integraciones, autonomía, tareas y workflows.

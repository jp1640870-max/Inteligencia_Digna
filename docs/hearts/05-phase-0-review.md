# 05 — Revisión de Fase 0

## 1. Estado

| Aspecto | Estado |
| --- | --- |
| Documentación 0.1–0.8 | Completa |
| Contratos puros | Completos y sin cableado |
| Pruebas unitarias | Pasan: 330 tests, 0 fallos |
| Pruebas de base de datos | Pasan: 5 tests, 0 fallos |
| TypeScript / ESLint | Pasan |
| Validación manual de UI | Pendiente del usuario |
| Aprobación de Fase 1 | No iniciada |

Fase 0 no cambia runtime, esquema, rutas ni UI. Los contratos son código muerto
desde el punto de vista de la aplicación: existen para las pruebas y para la
Fase 1.

## 2. Entregables

| ID | Entregable | Evidencia |
| --- | --- | --- |
| 0.1 | Inventario del flujo actual | `docs/hearts/00-current-state.md` |
| 0.2 | Matriz de seguridad y ACL | `docs/hearts/01-security-model.md` |
| 0.3 | Contratos puros | `lib/heart-definition.ts`, `lib/heart-execution.ts`, `lib/tool-contract.ts`, `docs/hearts/02-contracts.md` |
| 0.4 | Pruebas de caracterización | `tests/heart-definition.test.ts`, `tests/heart-execution.test.ts`, `tests/tool-contract.test.ts`, `tests/hearts-db.test.ts`, `tests/prompt-builder.test.ts` ampliado |
| 0.5 | Estrategia de migración | `docs/hearts/03-migration-plan.md` |
| 0.6 | Catálogo base de tools | `lib/tool-contract.ts`, `docs/hearts/04-tool-catalog.md` |
| 0.7 | Checklist de revisión | Este documento |
| 0.8 | Riesgos y decisiones | `docs/hearts/06-decisions.md` |

## 3. Pruebas agregadas

### 3.1 Contratos

- `tests/heart-definition.test.ts`
  - mapeo de fila actual y defaults;
  - campos futuros;
  - normalización de valores inválidos;
  - validación de nombre, descripción, temperatura, tools, scope, status,
    versión y conocimiento;
  - validación de snapshots versionados (`HeartVersion`);
  - transiciones y estados usables.
- `tests/heart-execution.test.ts`
  - modelo por defecto y modelo explícito;
  - temperatura;
  - intersección y deduplicación de tools;
  - rechazo de Hearts no publicados;
  - límites por defecto, override y rechazo de límites inválidos.
- `tests/tool-contract.test.ts`
  - catálogo completo;
  - IDs históricos;
  - validación de contratos;
  - guardas de tipo.

### 3.2 Caracterización existente ampliada

- `tests/prompt-builder.test.ts`
  - instrucciones de Heart con identidad, rol, tono, instrucciones y límites;
  - solo anuncia tools declaradas;
  - notas de documentos/web solo cuando corresponde;
  - `agentInstructions` reemplaza las notas genéricas.

### 3.3 Base de datos

- `tests/hearts-db.test.ts` (solo `npm run test:db`)
  - visibilidad personal/empresa;
  - lectura de personal ajeno;
  - lectura de empresa por otro usuario;
  - pin por usuario;
  - listados administrativos por scope;
  - vínculo `chats.heart_id` / `heart_name`.

## 4. Comandos de validación

```bash
npx tsc --noEmit
npx eslint lib/heart-definition.ts lib/heart-execution.ts lib/tool-contract.ts tests/heart-definition.test.ts tests/heart-execution.test.ts tests/tool-contract.test.ts tests/prompt-builder.test.ts tests/hearts-db.test.ts
npm test
npm run test:db
```

`npm run test:db` requiere `DATABASE_URL`. Si no está configurada, el test de
base de datos se marca como `skip`.

## 5. Checklist manual del usuario

Validar en la interfaz, sin cambiar código:

### 5.1 Hearts personales

- [ ] Crear un Heart personal desde la vista de usuario.
- [ ] Verlo en “Mis Hearts”.
- [ ] Editarlo y comprobar que se guardan nombre, rol, tono, instrucciones,
      límites, temperatura y tools.
- [ ] Fijarlo y desfijarlo.
- [ ] Abrir un chat con ese Heart.
- [ ] Comprobar que solo aparecen las tools declaradas.
- [ ] Comprobar que no se genera imagen dentro del Heart.
- [ ] Eliminarlo.

### 5.2 Hearts de empresa

- [ ] Entrar al panel admin con un rol con `hearts.manage`.
- [ ] Ver el tab “Hearts de Empresa”.
- [ ] Crear un Heart de empresa.
- [ ] Editarlo.
- [ ] Fijarlo globalmente.
- [ ] Usarlo desde la vista de usuario.
- [ ] Comprobar que otro usuario lo ve.
- [ ] Eliminarlo.

### 5.3 Moderación de Hearts personales

- [ ] Ver el tab “Hearts de Usuarios”.
- [ ] Abrir un Heart personal.
- [ ] Editar nombre, rol, tono, instrucciones, límites o tools.
- [ ] Comprobar que no se puede cambiar propietario ni `scope`.
- [ ] Comprobar que no aparece el fijado global.
- [ ] Eliminar un Heart personal de prueba.

### 5.4 Soporte

- [ ] Abrir Soporte desde Hearts.
- [ ] Comprobar que responde con KB y fuentes.
- [ ] Comprobar que no genera documentos, imágenes ni web.
- [ ] Preparar un escalamiento.
- [ ] Comprobar que es una vista previa y que no se crea ticket.
- [ ] Comprobar que el chat queda vinculado al Heart de Soporte.

### 5.5 Regresión

- [ ] Chat normal: documentos, web, imágenes y KB siguen funcionando.
- [ ] Regenerar una respuesta en chat normal, Heart y Soporte.
- [ ] Un usuario no ve Hearts personales de otro.
- [ ] Un usuario no puede editar un Heart de empresa.
- [ ] El agente oficial no se puede eliminar.
- [ ] La app arranca con `npm run dev:next`.

## 6. Criterios de salida

Fase 0 se considera cerrada cuando:

1. `npx tsc --noEmit` pasa.
2. ESLint dirigido pasa.
3. `npm test` pasa.
4. `npm run test:db` pasa o se marca `skip` por falta de base.
5. El checklist manual no tiene fallos bloqueantes.
6. El usuario aprueba explícitamente el cierre de Fase 0.

## 7. Bloqueos conocidos

- La validación manual de la interfaz depende del usuario.
- `npm run test:db` puede no ejecutarse si no hay `DATABASE_URL` en el entorno
  local.
- No se debe iniciar Fase 1 hasta la aprobación explícita.

## 8. Resultado de la ejecución

Completar al cerrar:

| Comando | Resultado |
| --- | --- |
| `npx tsc --noEmit` | Pasa, sin errores |
| `npx eslint ...` | Pasa, sin errores |
| `npm test` | 330 tests, 330 pass, 0 fail |
| `npm run test:db` (archivo dirigido) | 5 tests, 5 pass, 0 fail |
| Checklist manual | Pendiente del usuario |

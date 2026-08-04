// Active tenant. Phase 0 is single-tenant: every row belongs to the founder's
// farm, so this is a hardcoded constant. It MUST match the fixed id seeded by
// db/02_multitenant.sql (the fincas row + the finca_id column DEFAULT).
//
// Phase 1: this stops being a constant — finca_id comes from the authenticated
// user's tenant (JWT claim), and the DB column DEFAULT is dropped so every
// write must name it explicitly. Passing finca_id on every INSERT now (instead
// of leaning on the DEFAULT) is what makes that transition a config change,
// not a rewrite.
export const FINCA_ID = '00000000-0000-0000-0000-000000000001';

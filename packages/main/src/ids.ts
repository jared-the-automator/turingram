// Meeting IDs are crypto UUIDs; reject anything else before it touches the
// filesystem or a subprocess (defense against a crafted id from the renderer).
// One definition — this pattern used to exist in three copies, which is how a
// validator drifts.
export const SAFE_ID = /^[a-zA-Z0-9_-]{1,64}$/;

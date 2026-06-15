/* Dump fishdb data to JSON for the backend SQLite seed. */
const DIR = process.argv[2];
const db = await import(`file://${DIR}/fishdb.js`);
const out = {
  FISHES: db.FISHES, ECOLOGY: db.ECOLOGY, KNOWLEDGE: db.KNOWLEDGE,
  SOURCES: db.SOURCES, WATERS: db.WATERS,
};
process.stdout.write(JSON.stringify(out, null, 0));

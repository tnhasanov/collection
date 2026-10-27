import { writeFileSync } from "node:fs";
import { DATASETS } from "../src/server/modules/imports/datasets";
import { toCsvText } from "../src/server/modules/imports/csv";
for (const d of DATASETS) {
  const [headers, ...rows] = d.example;
  writeFileSync(`docs/templates/import-${d.code}.csv`, toCsvText(headers, rows));
  console.log(`wrote docs/templates/import-${d.code}.csv`);
}

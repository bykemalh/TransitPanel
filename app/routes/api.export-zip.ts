import JSZip from "jszip";
import { exportAllData } from "../lib/db-operations.server";

export async function loader() {
  const allData = await exportAllData();

  const zip = new JSZip();

  for (const [filename, content] of Object.entries(allData)) {
    zip.file(filename, JSON.stringify(content, null, 2));
  }

  const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });

  return new Response(zipBuffer, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="transitjson_export.zip"',
    },
  });
}

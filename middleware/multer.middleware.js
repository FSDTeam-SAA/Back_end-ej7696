import multer from "multer";
import fs from "fs";
const tempDir = "public/temp";
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

const storage = multer.memoryStorage();
const upload = multer({ storage });

export default upload;

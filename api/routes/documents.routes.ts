import { Router, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { env } from "../../config/env.js";
import {
  convertWordDocumentToPdf,
  isSupportedWordDocument,
} from "../../services/document-conversion.service.js";
import { logger } from "../../utils/logger.js";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { ValidationError } from "../middlewares/error.middleware.js";

const router = Router();
router.use(requireAuth);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.UPLOAD_MAX_SIZE_MB * 1024 * 1024, files: 1 },
});

router.post(
  "/convert-to-pdf",
  upload.single("file"),
  async (req: Request, res: Response, next: NextFunction) => {
    const startedAt = Date.now();
    try {
      const file = req.file;
      if (!file) throw new ValidationError("A Word document is required.");
      if (!isSupportedWordDocument(file.originalname, file.mimetype)) {
        throw new ValidationError("Choose a DOC or DOCX file.");
      }

      const pdf = await convertWordDocumentToPdf({
        buffer: file.buffer,
        originalName: file.originalname,
        mimeType: file.mimetype,
      });
      const outputName = `${file.originalname.replace(/\.(docx?|DOCX?)$/, "") || "document"}.pdf`;

      logger.info("[documents] converted Word document", {
        userId: req.user?.sub,
        inputBytes: file.size,
        outputBytes: pdf.length,
        elapsedMs: Date.now() - startedAt,
      });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Length", String(pdf.length));
      res.setHeader("Content-Disposition", `attachment; filename="${outputName.replace(/[\r\n\"]/g, "-")}"`);
      res.send(pdf);
    } catch (error) {
      next(error);
    }
  },
);

export default router;

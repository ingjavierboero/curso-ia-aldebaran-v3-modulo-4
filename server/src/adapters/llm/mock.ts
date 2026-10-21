import { classifyByFilename } from '../../domain/mock-classifier.ts';
import type { AttachmentClassifier } from '../types.ts';

/** Clasificador del modo mock: usa el nombre del archivo y nunca llama a la API de Claude (RF-187, RF-188). */
export const mockClassifier: AttachmentClassifier = {
  async classify({ filename }) {
    return classifyByFilename(filename);
  },
};

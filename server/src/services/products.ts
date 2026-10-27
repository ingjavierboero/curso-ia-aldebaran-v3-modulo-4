import { asc, eq } from 'drizzle-orm';
import type { Conn, Db } from '../db/client.ts';
import { products } from '../db/schema.ts';
import type { ProductInput } from '../http/types.ts';

export type Product = typeof products.$inferSelect;

export class ProductNotFoundError extends Error {}

export function listProducts(conn: Conn): Product[] {
  return conn.select().from(products).orderBy(asc(products.name), asc(products.id)).all();
}

export function getProduct(conn: Conn, id: number): Product {
  const product = conn.select().from(products).where(eq(products.id, id)).get();
  if (!product) throw new ProductNotFoundError('El producto no existe.');
  return product;
}

/** RF-42, RF-43: alta de un producto, que queda Activo. */
export function createProduct(db: Db, input: ProductInput, now: Date): Product {
  const at = now.toISOString();
  return db
    .insert(products)
    .values({ ...input, status: 'activo', createdAt: at, updatedAt: at })
    .returning()
    .get();
}

/**
 * RF-45, RF-46: modifica nombre, precio y moneda. Las facturas ya emitidas no cambian porque guardan
 * su propia copia del nombre y del precio (AC-45, AC-46).
 */
export function updateProduct(db: Db, id: number, changes: Partial<ProductInput>, now: Date): Product {
  return db.transaction((tx) => {
    getProduct(tx, id);
    return tx
      .update(products)
      .set({ ...changes, updatedAt: now.toISOString() })
      .where(eq(products.id, id))
      .returning()
      .get() as Product;
  });
}

/** RF-47, RF-48: desactivación (pasa a Inactivo) o reactivación (vuelve a Activo). */
export function setProductStatus(db: Db, id: number, status: Product['status'], now: Date): Product {
  return db.transaction((tx) => {
    getProduct(tx, id);
    return tx
      .update(products)
      .set({ status, updatedAt: now.toISOString() })
      .where(eq(products.id, id))
      .returning()
      .get() as Product;
  });
}

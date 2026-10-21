# ApiScript examples

Function and type names below assume an app named `shop`; always confirm
the real names in `generated/platform.d.ts`.

## Instance: state transition with an invariant

```ts
import * as app from "app.shop";
import * as actions from "app.shop.actions";

function execute(input: SubmitOrderInput): SubmitOrderOutput {
  const orders = app.filterOrder(
    [{ field: "_id", operator: "Eq", value: input.id }],
    ["_id", "status", "lines"]
  );
  if (orders.length == 0) {
    throw { code: "NOT_FOUND", message: "Order not found" };
  }
  const order: Order = orders[0];
  if (order.status != "draft") {
    throw { code: "ORDER_NOT_DRAFT", message: "Only draft orders can be submitted" };
  }
  if (order.lines.length == 0) {
    throw { code: "EMPTY_ORDER", message: "Add at least one line before submitting" };
  }
  let total = 0;
  for (let i = 0; i < order.lines.length; i = i + 1) {
    total = total + order.lines[i].quantity * order.lines[i].unitPriceCents;
  }
  app.updateOrderById(order._id, { status: "submitted", totalCents: total });
  return { orderId: order._id, totalCents: total };
}

return execute(input);
```

## Bulk: apply to several rows, all or nothing up front

Validate every row before writing any, then give them all the same
change with one `updateManyX` call. When each row gets its own values,
use `bulkUpdateX` (or `updateXById` per row) and a transaction to make it
all or nothing (see the last example).

```ts
import * as app from "app.shop";
import * as actions from "app.shop.actions";

function execute(input: ArchiveProductsInput): ArchiveProductsOutput {
  const products = app.filterProduct(
    [{ field: "_id", operator: "In", value: input.ids }],
    ["_id", "status"]
  );
  if (products.length != input.ids.length) {
    throw { code: "NOT_FOUND", message: "Some products do not exist" };
  }
  for (let i = 0; i < products.length; i = i + 1) {
    if (products[i].status == "archived") {
      throw { code: "ALREADY_ARCHIVED", message: "Product " + products[i]._id + " is already archived" };
    }
  }
  const result = app.updateManyProduct(
    [{ field: "_id", operator: "In", value: input.ids }],
    [{ field: "status", operator: "Set", value: "archived" }]
  );
  return { archivedCount: result.modified };
}

return execute(input);
```

## Class: aggregate without shipping rows to the client

```ts
import * as app from "app.shop";
import * as actions from "app.shop.actions";

function execute(input: MonthlySalesInput): MonthlySalesOutput {
  const orders = app.filterOrder(
    [
      { field: "status", operator: "Eq", value: "paid" },
      { field: "paidOn", operator: "Gte", value: input.startDate },
      { field: "paidOn", operator: "Lt", value: input.endDate },
    ],
    ["_id", "totalCents", "customerId"]
  );
  let total = 0;
  let byCustomer: Record<string, number> = {};
  for (let i = 0; i < orders.length; i = i + 1) {
    const o = orders[i];
    total = total + o.totalCents;
    byCustomer[o.customerId] = (byCustomer[o.customerId] ?? 0) + o.totalCents;
  }
  return { orderCount: orders.length, totalCents: total, totalsByCustomer: byCustomer };
}

return execute(input);
```

## Create a related document

```ts
import * as app from "app.shop";
import * as actions from "app.shop.actions";

function execute(input: AddReviewInput): AddReviewOutput {
  const products = app.filterProduct([{ field: "_id", operator: "Eq", value: input.id }], ["_id", "reviewCount"]);
  if (products.length == 0) {
    throw { code: "NOT_FOUND", message: "Product not found" };
  }
  const reviewId = app.createReview({ productId: input.id, rating: input.rating, text: input.text });
  app.updateProductById(input.id, { reviewCount: (products[0].reviewCount ?? 0) + 1 });
  return { reviewId: reviewId };
}

return execute(input);
```

## Several writes that must succeed together

```ts
import * as app from "app.shop";
import * as actions from "app.shop.actions";
import * as mongodb from "system.mongodb";

function execute(input: PlaceOrderInput): PlaceOrderOutput {
  const products = app.filterProduct([{ field: "_id", operator: "Eq", value: input.productId }], ["_id", "stock", "priceCents"]);
  if (products.length == 0) {
    throw { code: "NOT_FOUND", message: "Product not found" };
  }
  const product: Product = products[0];
  if (product.stock < input.quantity) {
    throw { code: "OUT_OF_STOCK", message: "Only " + product.stock + " left" };
  }

  const t = mongodb.createTransaction();
  const orderId = app.createOrder({ productId: product._id, quantity: input.quantity, totalCents: product.priceCents * input.quantity }, t);
  app.updateProductById(product._id, { stock: product.stock - input.quantity }, t);
  mongodb.commitTransaction(t);

  return { orderId: orderId };
}

return execute(input);
```

Without the transaction, a failure between the two writes would leave an
order whose stock was never taken.

## Porting cheatsheet

| Existing code | ApiScript |
|---|---|
| `await db.orders.findOne({ id })` | `app.filterOrder([{ field: "_id", operator: "Eq", value: id }], [...fields])[0]` |
| `where status in (...)` | `{ field: "status", operator: "In", value: [...] }` |
| `ORDER BY createdOn DESC LIMIT 10` | `filterX(conds, fields, "createdOn", true, 10)` (field must be indexed) |
| `orders.map(o => o.total)` | index loop pushing into an array |
| `` `Order ${id}` `` | `"Order " + id` |
| `x?.y` | `x != null ? x.y : null` |
| `i++`, `n += 2` | `i = i + 1`, `n = n + 2` |
| `try { … } catch { … }` | validate first, then `throw { code, message }` |
| `session.withTransaction(...)` / `BEGIN … COMMIT` | `const t = mongodb.createTransaction();`, pass `t` last to every write, `mongodb.commitTransaction(t);` before returning |
| `ROLLBACK` on error | `throw { code, message }` before the commit (the open transaction is aborted) |

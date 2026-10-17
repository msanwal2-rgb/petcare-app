using System.Text;
using Dapper;
using Leash.Core.Models.Entities;
using Leash.Core.Persistence;
using Leash.Core.Repositories.Interfaces;
using Npgsql;

namespace Leash.Core.Repositories;

/// <summary>Dapper over <c>orders</c>, <c>order_items</c> and <c>order_events</c>.</summary>
public sealed class OrderRepository(NpgsqlDataSource db) : IOrderRepository
{
    /// <summary>
    /// <c>benefitsApplied</c> is a nullable <c>text[]</c>, and Dapper writes a
    /// NULL straight over the entity's <c>[]</c> default — so it is coalesced
    /// here rather than null-checked at every reader.
    /// </summary>
    private const string Columns = """
        id AS "Id", "userId" AS "UserId", status AS "Status",
        "paymentStatus" AS "PaymentStatus", "paymentRef" AS "PaymentRef",
        "subtotalCents" AS "SubtotalCents", "shippingCents" AS "ShippingCents",
        "taxCents" AS "TaxCents", "totalCents" AS "TotalCents",
        "shipName" AS "ShipName", "shipLine1" AS "ShipLine1", "shipLine2" AS "ShipLine2",
        "shipCity" AS "ShipCity", "shipState" AS "ShipState",
        "shipPostalCode" AS "ShipPostalCode", "shipCountry" AS "ShipCountry",
        "shipPhone" AS "ShipPhone", "deliveryInstructions" AS "DeliveryInstructions",
        carrier AS "Carrier", "trackingNumber" AS "TrackingNumber",
        "placedAt" AS "PlacedAt", "estimatedDeliveryAt" AS "EstimatedDeliveryAt",
        "deliveredAt" AS "DeliveredAt", "reservationExpiresAt" AS "ReservationExpiresAt",
        COALESCE("benefitsApplied", '{}') AS "BenefitsApplied"
        """;

    private const string ItemColumns = """
        id AS "Id", "orderId" AS "OrderId", "productId" AS "ProductId",
        name AS "Name", brand AS "Brand", "imageUrl" AS "ImageUrl", slug AS "Slug",
        "unitPriceCents" AS "UnitPriceCents", quantity AS "Quantity",
        "lineTotalCents" AS "LineTotalCents"
        """;

    private const string EventColumns = """
        id AS "Id", "orderId" AS "OrderId", status AS "Status", label AS "Label",
        description AS "Description", location AS "Location", "occurredAt" AS "OccurredAt"
        """;

    /// <summary>Not a parcel yet, or not a parcel any more.</summary>
    private static readonly string[] NotInFulfilment =
        ["pending_payment", "delivered", "cancelled", "refunded"];

    public async Task CreateAsync(
        OrderEntity order, IReadOnlyList<OrderItemEntity> items, OrderEventEntity firstEvent,
        ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);

        await session.Connection.ExecuteAsync(new CommandDefinition(
            """
            INSERT INTO orders (
                id, "userId", status, "paymentStatus", "paymentRef",
                "subtotalCents", "shippingCents", "taxCents", "totalCents",
                "shipName", "shipLine1", "shipLine2", "shipCity", "shipState",
                "shipPostalCode", "shipCountry", "shipPhone", "deliveryInstructions",
                carrier, "trackingNumber", "placedAt", "estimatedDeliveryAt",
                "deliveredAt", "reservationExpiresAt", "benefitsApplied")
            VALUES (
                @Id, @UserId, @Status, @PaymentStatus, @PaymentRef,
                @SubtotalCents, @ShippingCents, @TaxCents, @TotalCents,
                @ShipName, @ShipLine1, @ShipLine2, @ShipCity, @ShipState,
                @ShipPostalCode, @ShipCountry, @ShipPhone, @DeliveryInstructions,
                @Carrier, @TrackingNumber, @PlacedAt, @EstimatedDeliveryAt,
                @DeliveredAt, @ReservationExpiresAt, @BenefitsApplied)
            """,
            order, session.Transaction, cancellationToken: ct));

        await session.Connection.ExecuteAsync(new CommandDefinition(
            """
            INSERT INTO order_items (
                id, "orderId", "productId", name, brand, "imageUrl", slug,
                "unitPriceCents", quantity, "lineTotalCents")
            VALUES (
                @Id, @OrderId, @ProductId, @Name, @Brand, @ImageUrl, @Slug,
                @UnitPriceCents, @Quantity, @LineTotalCents)
            """,
            items, session.Transaction, cancellationToken: ct));

        // On this session, not via AddEventAsync — that would open its own
        // connection when no scope was passed and the event would land outside
        // the order's transaction.
        await session.Connection.ExecuteAsync(new CommandDefinition(
            """
            INSERT INTO order_events (id, "orderId", status, label, description, location, "occurredAt")
            VALUES (@Id, @OrderId, @Status, @Label, @Description, @Location, @OccurredAt)
            """,
            firstEvent, session.Transaction, cancellationToken: ct));
    }

    public async Task<OrderEntity?> GetByIdAsync(
        string id, ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        return await session.Connection.QuerySingleOrDefaultAsync<OrderEntity>(
            new CommandDefinition(
                $"SELECT {Columns} FROM orders WHERE id = @id",
                new { id }, session.Transaction, cancellationToken: ct));
    }

    public async Task<IReadOnlyList<OrderItemEntity>> ListItemsAsync(
        IReadOnlyCollection<string> orderIds,
        ITransactionScope? scope = null, CancellationToken ct = default)
    {
        if (orderIds.Count == 0) return [];

        await using var session = await DbSession.OpenAsync(db, scope, ct);
        var rows = await session.Connection.QueryAsync<OrderItemEntity>(
            new CommandDefinition(
                $"""
                 SELECT {ItemColumns} FROM order_items
                 WHERE "orderId" = ANY(@orderIds)
                 ORDER BY "orderId", id
                 """,
                new { orderIds = orderIds.ToArray() },
                session.Transaction, cancellationToken: ct));

        return rows.ToList();
    }

    public async Task<IReadOnlyList<OrderEventEntity>> ListEventsAsync(
        IReadOnlyCollection<string> orderIds,
        ITransactionScope? scope = null, CancellationToken ct = default)
    {
        if (orderIds.Count == 0) return [];

        await using var session = await DbSession.OpenAsync(db, scope, ct);
        var rows = await session.Connection.QueryAsync<OrderEventEntity>(
            new CommandDefinition(
                $"""
                 SELECT {EventColumns} FROM order_events
                 WHERE "orderId" = ANY(@orderIds)
                 ORDER BY "orderId", "occurredAt" ASC, id ASC
                 """,
                new { orderIds = orderIds.ToArray() },
                session.Transaction, cancellationToken: ct));

        return rows.ToList();
    }

    public async Task<(IReadOnlyList<OrderEntity> Rows, string? NextCursor)> ListByUserAsync(
        string userId, string? cursor, int limit,
        ITransactionScope? scope = null, CancellationToken ct = default)
    {
        limit = Math.Clamp(limit, 1, 100);
        var (cursorPlacedAt, cursorId) = Cursor.DecodeTimestamp(cursor);

        var where = new StringBuilder("""WHERE "userId" = @userId""");
        if (cursorId is not null)
            where.Append(""" AND ("placedAt", id) < (@cursorPlacedAt, @cursorId)""");

        await using var session = await DbSession.OpenAsync(db, scope, ct);
        var rows = (await session.Connection.QueryAsync<OrderEntity>(
            new CommandDefinition(
                $"""
                 SELECT {Columns} FROM orders
                 {where}
                 ORDER BY "placedAt" DESC, id DESC
                 LIMIT @limitPlusOne
                 """,
                new { userId, cursorPlacedAt, cursorId, limitPlusOne = limit + 1 },
                session.Transaction, cancellationToken: ct))).ToList();

        string? next = null;
        if (rows.Count > limit)
        {
            rows.RemoveAt(rows.Count - 1);
            next = Cursor.Encode(rows[^1].PlacedAt, rows[^1].Id);
        }

        return (rows, next);
    }

    public async Task<(IReadOnlyList<OrderEntity> Rows, string? NextCursor)> ListForFulfilmentAsync(
        string? cursor, int limit,
        ITransactionScope? scope = null, CancellationToken ct = default)
    {
        limit = Math.Clamp(limit, 1, 200);
        var (cursorPlacedAt, cursorId) = Cursor.DecodeTimestamp(cursor);

        var where = new StringBuilder("WHERE status <> ALL(@notInFulfilment)");
        if (cursorId is not null)
            where.Append(""" AND ("placedAt", id) > (@cursorPlacedAt, @cursorId)""");

        await using var session = await DbSession.OpenAsync(db, scope, ct);
        var rows = (await session.Connection.QueryAsync<OrderEntity>(
            new CommandDefinition(
                $"""
                 SELECT {Columns} FROM orders
                 {where}
                 ORDER BY "placedAt" ASC, id ASC
                 LIMIT @limitPlusOne
                 """,
                new
                {
                    notInFulfilment = NotInFulfilment,
                    cursorPlacedAt,
                    cursorId,
                    limitPlusOne = limit + 1,
                },
                session.Transaction, cancellationToken: ct))).ToList();

        string? next = null;
        if (rows.Count > limit)
        {
            rows.RemoveAt(rows.Count - 1);
            next = Cursor.Encode(rows[^1].PlacedAt, rows[^1].Id);
        }

        return (rows, next);
    }

    public async Task<bool> TryMoveStatusAsync(
        string id, string from, string to,
        string? carrier, string? trackingNumber, DateTimeOffset? deliveredAt, bool clearHold,
        ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);

        // COALESCE with casts: an omitted carrier must leave the stored one
        // alone, and PostgreSQL will not guess the type of an untyped NULL.
        var changed = await session.Connection.ExecuteAsync(new CommandDefinition(
            """
            UPDATE orders SET
                status           = @to,
                carrier          = COALESCE(@carrier::text, carrier),
                "trackingNumber" = COALESCE(@trackingNumber::text, "trackingNumber"),
                "deliveredAt"    = COALESCE(@deliveredAt::timestamptz, "deliveredAt"),
                "reservationExpiresAt" =
                    CASE WHEN @clearHold THEN NULL ELSE "reservationExpiresAt" END
            WHERE id = @id AND status = @from
            """,
            new { id, from, to, carrier, trackingNumber, deliveredAt, clearHold },
            session.Transaction, cancellationToken: ct));

        return changed == 1;
    }

    public async Task AddEventAsync(
        OrderEventEntity orderEvent,
        ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        await session.Connection.ExecuteAsync(new CommandDefinition(
            """
            INSERT INTO order_events (id, "orderId", status, label, description, location, "occurredAt")
            VALUES (@Id, @OrderId, @Status, @Label, @Description, @Location, @OccurredAt)
            """,
            orderEvent, session.Transaction, cancellationToken: ct));
    }

    public async Task SetPaymentAsync(
        string id, string paymentStatus, string? paymentRef, bool releaseHold,
        ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        await session.Connection.ExecuteAsync(new CommandDefinition(
            """
            UPDATE orders SET
                "paymentStatus" = @paymentStatus,
                "paymentRef"    = COALESCE(@paymentRef::text, "paymentRef"),
                "reservationExpiresAt" =
                    CASE WHEN @releaseHold THEN NULL ELSE "reservationExpiresAt" END
            WHERE id = @id
            """,
            new { id, paymentStatus, paymentRef, releaseHold },
            session.Transaction, cancellationToken: ct));
    }

    public async Task<IReadOnlyList<string>> ClaimExpiredReservationsAsync(
        IReadOnlyCollection<string>? productIds, DateTimeOffset now,
        ITransactionScope? scope = null, CancellationToken ct = default)
    {
        if (productIds is { Count: 0 }) return [];

        await using var session = await DbSession.OpenAsync(db, scope, ct);

        // Scoped to the products in the basket on the checkout path: a full
        // scan there would make every purchase pay for everyone else's
        // abandoned ones. The daily sweep passes null and takes them all.
        var claimed = await session.Connection.QueryAsync<string>(new CommandDefinition(
            """
            UPDATE orders o SET status = 'cancelled', "reservationExpiresAt" = NULL
            WHERE o.status = 'pending_payment'
              AND o."reservationExpiresAt" IS NOT NULL
              AND o."reservationExpiresAt" < @now
              AND (@productIds::text[] IS NULL OR EXISTS (
                    SELECT 1 FROM order_items i
                    WHERE i."orderId" = o.id AND i."productId" = ANY(@productIds)))
            RETURNING o.id
            """,
            new { productIds = productIds?.ToArray(), now },
            session.Transaction, cancellationToken: ct));

        return claimed.ToList();
    }
}


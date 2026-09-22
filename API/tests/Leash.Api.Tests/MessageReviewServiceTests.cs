using Dapper;
using Leash.Core.Models.Dtos;
using Leash.Core.Models.Enums;
using Leash.Core.Services.Interfaces;
using Leash.Api.Tests.Infrastructure;

namespace Leash.Api.Tests;

/// <summary>
/// The ports of <c>tests/messages.test.ts</c> and <c>tests/reviews.test.ts</c>,
/// plus the ratings half of <c>tests/reputation.test.ts</c>.
///
/// Seed shape these lean on:
///   b1  — a *requested* booking: owner u1, caretaker c1 (= user u7)
///   b7  — carries three seeded messages
///   b10 — completed: owner u3, caretaker c4 (= user u10); the seed already
///         holds u3's review of it, so the tests that need that direction
///         clear it first
///   b9  — completed, and carries both directions already
/// </summary>
[Collection(DatabaseCollection.Name)]
public sealed class MessageReviewServiceTests(DatabaseFixture db) : IAsyncLifetime
{
    private const string Owner = "u1";
    private const string CaretakerUser = "u7";
    private const string Stranger = "u2";

    private CoreHost _core = null!;
    private IMessageService _messages = null!;
    private IReviewService _reviews = null!;

    public async Task InitializeAsync()
    {
        await db.ResetAsync();
        _core = new CoreHost(db.ConnectionString);
        _messages = _core.Get<IMessageService>();
        _reviews = _core.Get<IReviewService>();
    }

    public async Task DisposeAsync() => await _core.DisposeAsync();

    // ── Messaging ────────────────────────────────────────────────────────

    [Fact]
    public async Task Returns_a_thread_oldest_first()
    {
        var booking = await BookingPartiesAsync("b7");
        var thread = await _messages.ListAsync(booking.OwnerId, "b7");

        Assert.Equal(3, thread!.Count);
        for (var i = 1; i < thread.Count; i++)
            Assert.True(thread[i - 1].CreatedAt <= thread[i].CreatedAt);
    }

    [Fact]
    public async Task Sends_a_message_on_a_booking()
    {
        var message = await _messages.SendAsync(Owner, "b1", "Hello there!");

        Assert.StartsWith("m_", message!.Id);
        Assert.Equal(Owner, message.FromUserId);

        // Unread until the other party actually reads it — see below for why
        // that is not a detail.
        Assert.Null(message.ReadAt);

        var thread = await _messages.ListAsync(Owner, "b1");
        Assert.Contains("Hello there!", thread!.Select(m => m.Body));
    }

    [Fact]
    public async Task Both_parties_can_read_and_write_the_thread()
    {
        Assert.NotNull(await _messages.SendAsync(Owner, "b1", "from the owner"));
        Assert.NotNull(await _messages.SendAsync(CaretakerUser, "b1", "from the caretaker"));

        Assert.Equal(2, (await _messages.ListAsync(CaretakerUser, "b1"))!.Count);
    }

    [Fact]
    public async Task Nobody_else_can_read_or_write_the_thread()
    {
        // REQUIREMENTS.md C9: between the two parties only.
        Assert.Null(await _messages.ListAsync(Stranger, "b1"));
        Assert.Null(await _messages.SendAsync(Stranger, "b1", "hello?"));
        Assert.Null(await _messages.MarkReadAsync(Stranger, "b1"));
    }

    [Fact]
    public async Task Marks_the_other_partys_messages_read_and_not_your_own()
    {
        await _messages.SendAsync(Owner, "b1", "from owner");
        await _messages.SendAsync(CaretakerUser, "b1", "from caretaker");

        var moved = await _messages.MarkReadAsync(Owner, "b1");
        Assert.Equal(1, moved);

        var thread = await _messages.ListAsync(Owner, "b1");
        Assert.Null(thread!.Single(m => m.FromUserId == Owner).ReadAt);
        Assert.NotNull(thread.Single(m => m.FromUserId == CaretakerUser).ReadAt);
    }

    [Fact]
    public async Task Reading_the_thread_does_not_mark_anything_read()
    {
        // REQUIREMENTS.md C10, and the reason it is a requirement: the reference
        // marked messages read *inside* the GET that returns them, so it
        // serialised them as already-read. An unread inbound message was
        // literally unreturnable, and no unread badge could ever be correct.
        await _messages.SendAsync(CaretakerUser, "b1", "did you see this?");

        var first = await _messages.ListAsync(Owner, "b1");
        var second = await _messages.ListAsync(Owner, "b1");

        Assert.All(first!, m => Assert.Null(m.ReadAt));
        Assert.All(second!, m => Assert.Null(m.ReadAt));
    }

    [Fact]
    public async Task Marking_read_twice_moves_nothing_the_second_time()
    {
        await _messages.SendAsync(CaretakerUser, "b1", "hello");

        Assert.Equal(1, await _messages.MarkReadAsync(Owner, "b1"));
        Assert.Equal(0, await _messages.MarkReadAsync(Owner, "b1"));
    }

    // ── Reading reviews ──────────────────────────────────────────────────

    [Fact]
    public async Task Returns_reviews_about_a_user_newest_first()
    {
        var reviews = await _reviews.ListForUserAsync("u14", null);

        Assert.NotEmpty(reviews);
        Assert.All(reviews, r => Assert.Equal("u14", r.ToUserId));
        for (var i = 1; i < reviews.Count; i++)
            Assert.True(reviews[i - 1].CreatedAt >= reviews[i].CreatedAt);
    }

    [Fact]
    public async Task Returns_nothing_for_a_user_nobody_has_reviewed()
    {
        Assert.Empty(await _reviews.ListForUserAsync("u5", null));
    }

    [Fact]
    public async Task Returns_both_reviews_attached_to_a_booking()
    {
        Assert.Equal(2, (await _reviews.ListForSubjectAsync("b9")).Count);
    }

    [Fact]
    public async Task Separates_a_vets_reviews_from_a_caretakers()
    {
        // One table, two kinds — so a person who is both never has the two
        // mistaken for each other.
        var vetOnly = await _reviews.ListForUserAsync("u17", ReviewKinds.VetAppointment);

        Assert.NotEmpty(vetOnly);
        Assert.All(vetOnly, r => Assert.Equal(ReviewKinds.VetAppointment, r.Kind));
        Assert.Empty(await _reviews.ListForUserAsync("u17", ReviewKinds.Booking));
    }

    [Fact]
    public async Task Reports_the_subject_a_review_belongs_to()
    {
        var review = (await _reviews.ListForSubjectAsync("a1"))[0];

        // `subjectId` on the wire, `bookingId` in the column — and here it holds
        // an appointment id, which is exactly why the DTO renames it.
        Assert.Equal("a1", review.SubjectId);
        Assert.Equal(ReviewKinds.VetAppointment, review.Kind);
    }

    // ── Writing reviews ──────────────────────────────────────────────────

    [Fact]
    public async Task Accepts_a_review_from_the_owner_about_the_caretaker()
    {
        await ClearReviewAsync("b10", "u3");

        var (review, failure) = await _reviews.CreateAsync(
            "u3", "b10", new CreateReviewRequest("u10", 5, "Clear, kind and on time."));

        Assert.Null(failure);
        Assert.StartsWith("r_", review!.Id);
        Assert.Equal("b10", review.SubjectId);
        Assert.Equal(ReviewKinds.Booking, review.Kind);
    }

    [Fact]
    public async Task Accepts_the_caretaker_reviewing_the_owner_back()
    {
        // Bidirectional (REQUIREMENTS.md C11): each judges how the other
        // behaved.
        var (_, failure) = await _reviews.CreateAsync(
            "u10", "b10", new CreateReviewRequest("u3", 5, "Easy to deal with."));

        Assert.Null(failure);
    }

    [Fact]
    public async Task Refuses_someone_who_had_nothing_to_do_with_it()
    {
        // Before the reference fixed this, any signed-in user could post
        // unlimited reviews about anyone, for a booking they had nothing to do
        // with and that had never happened.
        var (_, failure) = await _reviews.CreateAsync(
            Owner, "b10", new CreateReviewRequest("u10", 5, null));

        Assert.Equal(ReviewFailure.NotParticipant, failure);
    }

    [Fact]
    public async Task Refuses_a_review_aimed_at_someone_outside_the_booking()
    {
        var (_, failure) = await _reviews.CreateAsync(
            "u3", "b10", new CreateReviewRequest(Owner, 5, null));

        Assert.Equal(ReviewFailure.WrongRecipient, failure);
    }

    [Fact]
    public async Task Refuses_a_booking_that_has_not_happened_yet()
    {
        // b1 is still `requested`. And `completed` is set by the caretaker
        // alone, which is what stops an owner manufacturing a reviewable
        // history for themselves.
        var (_, failure) = await _reviews.CreateAsync(
            Owner, "b1", new CreateReviewRequest(CaretakerUser, 5, null));

        Assert.Equal(ReviewFailure.NotCompleted, failure);
    }

    [Fact]
    public async Task Refuses_an_unknown_booking()
    {
        var (_, failure) = await _reviews.CreateAsync(
            "u3", "ghost", new CreateReviewRequest("u10", 5, null));

        Assert.Equal(ReviewFailure.NotFound, failure);
    }

    [Fact]
    public async Task Allows_one_review_per_person_not_two()
    {
        await ClearReviewAsync("b10", "u3");

        var (_, first) = await _reviews.CreateAsync(
            "u3", "b10", new CreateReviewRequest("u10", 5, "Great."));
        Assert.Null(first);

        var (_, second) = await _reviews.CreateAsync(
            "u3", "b10", new CreateReviewRequest("u10", 1, "Changed my mind."));

        // A review you can rewrite after the fact is a negotiating position.
        Assert.Equal(ReviewFailure.AlreadyReviewed, second);
    }

    // ── Ratings ──────────────────────────────────────────────────────────

    [Fact]
    public async Task A_review_moves_the_caretakers_headline_score()
    {
        await ClearReviewAsync("b10", "u3");
        var before = await CaretakerRatingAsync("c4");

        await _reviews.CreateAsync("u3", "b10", new CreateReviewRequest("u10", 1, "Poor."));

        var after = await CaretakerRatingAsync("c4");
        Assert.Equal(before.Count + 1, after.Count);
        Assert.True(after.Rating < before.Rating);
    }

    [Fact]
    public async Task One_bad_review_barely_dents_a_long_good_history_but_still_registers()
    {
        await ClearReviewAsync("b10", "u3");
        var before = await CaretakerRatingAsync("c4");

        await _reviews.CreateAsync("u3", "b10", new CreateReviewRequest("u10", 1, "Poor."));
        var after = await CaretakerRatingAsync("c4");

        // A long good history absorbs a single 1-star almost entirely...
        Assert.True(before.Rating - after.Rating < 0.5);

        // ...but it must still register. Rounding the *stored* value would
        // swallow a change this small, and the rating would then freeze
        // permanently however many bad reviews arrived.
        Assert.True(after.Rating < before.Rating);
    }

    [Fact]
    public async Task Reviewing_an_owner_scores_nobody()
    {
        // Owners get reviewed too and have no professional profile. A no-op, not
        // an error.
        var (review, failure) = await _reviews.CreateAsync(
            "u10", "b10", new CreateReviewRequest("u3", 5, "Easy to deal with."));

        Assert.Null(failure);
        Assert.NotNull(review);
    }

    // ── Helpers ──────────────────────────────────────────────────────────

    private async Task ClearReviewAsync(string subjectId, string fromUserId)
    {
        await using var conn = await db.DataSource.OpenConnectionAsync();
        await conn.ExecuteAsync(
            """DELETE FROM reviews WHERE "bookingId" = @subjectId AND "fromUserId" = @fromUserId""",
            new { subjectId, fromUserId });
    }

    private async Task<(double Rating, int Count)> CaretakerRatingAsync(string caretakerId)
    {
        await using var conn = await db.DataSource.OpenConnectionAsync();
        return await conn.QuerySingleAsync<(double, int)>(
            """SELECT rating, "reviewCount" FROM caretaker_profiles WHERE id = @caretakerId""",
            new { caretakerId });
    }

    private async Task<(string OwnerId, string CaretakerId)> BookingPartiesAsync(string id)
    {
        await using var conn = await db.DataSource.OpenConnectionAsync();
        return await conn.QuerySingleAsync<(string, string)>(
            """SELECT "ownerId", "caretakerId" FROM bookings WHERE id = @id""", new { id });
    }
}

using Dapper;
using Leash.Api.Tests.Infrastructure;
using Leash.Core.Models.Dtos;
using Leash.Core.Models.Enums;
using Leash.Core.Services.Interfaces;
using Npgsql;

namespace Leash.Api.Tests;

/// <summary>
/// The port of <c>tests/admin.test.ts</c>, plus the M9 rules the reference left
/// to its routes: every service re-checks the caller's staff role (D1), and the
/// finance and verification screens it had no suite for.
///
/// ── Departures ──
///
///  1. <b>Pages are keyset, not offset.</b> "Paginates without overlap" walks a
///     cursor; the total is still reported.
///  2. <b>Authority is checked in the service.</b> The reference checked it in
///     each route handler; here a method called by the wrong role refuses, so
///     a future route that forgets cannot open it.
///  3. <b>Suspending and signing out also revoke refresh tokens</b>
///     (ARCHITECTURE.md §4) — the reference had no native-app tokens.
///  4. <b>The audit entry commits with the action</b>, in one transaction,
///     rather than best-effort afterwards.
///  5. <b>The overview is for any staff role</b> (REQUIREMENTS.md §10.2); the
///     reference checked <c>support</c>, so ops-only staff saw nothing.
///
/// ── Fixtures ──
///
/// u22 Priya is admin; u21 Rosa is ops; u23 Tom is support + finance.
/// </summary>
[Collection(DatabaseCollection.Name)]
public sealed class AdminServiceTests(DatabaseFixture db) : IAsyncLifetime
{
    private const string AdminId = "u22";
    private const string Ops = "u21";
    private const string Support = "u23";     // support + finance

    private static readonly StaffActor Admin = new(AdminId, "203.0.113.7");
    private static readonly StaffActor Tom = new(Support);

    private CoreHost _core = null!;
    private IAdminUserService _users = null!;
    private IAuditLog _audit = null!;

    public async Task InitializeAsync()
    {
        await db.ResetAsync();
        _core = new CoreHost(db.ConnectionString);
        _users = _core.Get<IAdminUserService>();
        _audit = _core.Get<IAuditLog>();
    }

    public async Task DisposeAsync() => await _core.DisposeAsync();

    private async Task<T> One<T>(string sql, object? args = null)
    {
        await using var conn = new NpgsqlConnection(db.ConnectionString);
        return await conn.QuerySingleAsync<T>(sql, args);
    }

    private async Task Exec(string sql, object? args = null)
    {
        await using var conn = new NpgsqlConnection(db.ConnectionString);
        await conn.ExecuteAsync(sql, args);
    }

    private async Task<AdminUserPage> Search(AdminUserQuery query, string caller = Support)
    {
        var (page, refusal) = await _users.SearchAsync(caller, query);
        Assert.Null(refusal);
        return page!;
    }

    private async Task<AdminAuditEntryDto[]> AuditFor(AdminAuditQuery query)
        => (await _audit.ListAsync(AdminId, query)).Page!.Items;

    // ── Staff roles ──────────────────────────────────────────────────────

    [Fact]
    public async Task Lets_admin_satisfy_every_other_role()
    {
        var access = _core.Get<IAccessService>();
        foreach (var role in new[] { StaffRoles.Ops, StaffRoles.Finance, StaffRoles.Support })
            Assert.True(await access.HasStaffRoleAsync(AdminId, role));
    }

    [Fact]
    public async Task Does_not_let_one_specific_role_stand_in_for_another()
    {
        var access = _core.Get<IAccessService>();
        Assert.False(await access.HasStaffRoleAsync(Ops, StaffRoles.Finance));
        Assert.False(await access.HasStaffRoleAsync(Support, StaffRoles.Ops));
        Assert.False(await access.HasStaffRoleAsync("ghost", StaffRoles.Admin));
    }

    [Fact]
    public async Task Refuses_a_non_staff_caller_with_an_explanation()
    {
        // D2: route existence is not a secret, so the refusal says why.
        var (page, refusal) = await _users.SearchAsync("u1", new AdminUserQuery());

        Assert.Null(page);
        Assert.Equal(AdminFailure.NotStaff, refusal!.Kind);
        Assert.Contains("support", refusal.Message);
    }

    [Fact]
    public async Task Refuses_the_wrong_staff_role()
    {
        // Ops runs fulfilment; reading customer accounts is support's.
        Assert.Equal(AdminFailure.NotStaff, (await _users.SearchAsync(Ops, new AdminUserQuery())).Refusal!.Kind);
    }

    // ── User search ──────────────────────────────────────────────────────

    [Fact]
    public async Task Paginates_without_overlap_or_gaps()
    {
        var all = await Search(new AdminUserQuery { Limit = 100 });
        var seen = new List<string>();
        string? cursor = null;
        do
        {
            var page = await Search(new AdminUserQuery { Limit = 5, Cursor = cursor });
            Assert.True(page.Items.Length <= 5);
            Assert.Equal(all.Total, page.Total);
            seen.AddRange(page.Items.Select(u => u.Id));
            cursor = page.NextCursor;
        } while (cursor is not null);

        Assert.Equal(all.Items.Select(u => u.Id), seen);
    }

    [Theory]
    [InlineData("newest")]
    [InlineData("oldest")]
    [InlineData("name")]
    [InlineData("recent_login")]
    public async Task Walks_every_sort_one_row_at_a_time(string sort)
    {
        await Exec("UPDATE users SET \"lastLoginAt\" = now() - (random() * interval '30 days') WHERE id IN ('u1','u3','u7')");
        var all = await Search(new AdminUserQuery { Sort = sort, Limit = 100 });

        var seen = new List<string>();
        string? cursor = null;
        do
        {
            var page = await Search(new AdminUserQuery { Sort = sort, Limit = 1, Cursor = cursor });
            seen.AddRange(page.Items.Select(u => u.Id));
            cursor = page.NextCursor;
        } while (cursor is not null);

        Assert.Equal(all.Items.Select(u => u.Id), seen);
    }

    [Fact]
    public async Task Caps_an_absurd_limit_rather_than_dumping_the_table()
    {
        var page = await Search(new AdminUserQuery { Limit = 100_000 });
        Assert.True(page.Items.Length <= 100);
    }

    [Fact]
    public async Task Finds_by_email_fragment_case_insensitively()
        => Assert.Contains("u1", (await Search(new AdminUserQuery { Q = "MAYA.CHEN" })).Items.Select(u => u.Id));

    [Fact]
    public async Task Matches_an_id_exactly_so_u1_does_not_drag_in_u10()
    {
        var ids = (await Search(new AdminUserQuery { Q = "u1" })).Items.Select(u => u.Id).ToArray();
        Assert.Contains("u1", ids);
        Assert.DoesNotContain("u10", ids);
    }

    [Fact]
    public async Task Treats_wildcards_in_a_search_as_text()
        => Assert.Equal(0, (await Search(new AdminUserQuery { Q = "%" })).Total);

    [Fact]
    public async Task Filters_by_staff_role()
        => Assert.Equal([Ops], (await Search(new AdminUserQuery { StaffRole = "ops" })).Items.Select(u => u.Id));

    [Fact]
    public async Task Filters_by_marketplace_role()
    {
        var page = await Search(new AdminUserQuery { Role = "vet", Limit = 100 });
        Assert.NotEmpty(page.Items);
        Assert.All(page.Items, u => Assert.Contains("vet", u.Roles));
    }

    [Fact]
    public async Task Filters_by_how_the_account_signs_in()
    {
        var page = await Search(new AdminUserQuery { AuthMethod = "password", Limit = 100 });
        Assert.All(page.Items, u => Assert.Contains("password", u.AuthMethods));

        // Nothing seeded is linked to Google.
        Assert.Equal(0, (await Search(new AdminUserQuery { AuthMethod = "google" })).Total);
    }

    [Fact]
    public async Task Never_returns_a_password_hash()
    {
        var page = await Search(new AdminUserQuery { Limit = 100 });
        Assert.DoesNotContain("$2", System.Text.Json.JsonSerializer.Serialize(page));
    }

    [Fact]
    public async Task Sorts_by_name()
    {
        var names = (await Search(new AdminUserQuery { Sort = "name", Limit = 100 })).Items.Select(u => u.Name).ToArray();
        Assert.Equal(names.OrderBy(n => n, StringComparer.Create(System.Globalization.CultureInfo.InvariantCulture, true)), names);
    }

    // ── User detail ──────────────────────────────────────────────────────

    [Fact]
    public async Task Gathers_counts_and_profiles_in_one_shot()
    {
        var (detail, _) = await _users.GetAsync(Support, "u1");

        Assert.True(detail!.Counts.Pets > 0);
        Assert.True(detail.Counts.Bookings > 0);
        Assert.Contains("password", detail.AuthMethods);
        Assert.NotEmpty(detail.RecentOrders);
    }

    [Fact]
    public async Task Shows_a_caretakers_and_a_vets_profile()
    {
        Assert.NotNull((await _users.GetAsync(Support, "u7")).Detail!.CaretakerProfile);
        Assert.NotNull((await _users.GetAsync(Support, "u17")).Detail!.VetProfile);
    }

    [Fact]
    public async Task Returns_not_found_for_an_unknown_id()
        => Assert.Equal(AdminFailure.NotFound, (await _users.GetAsync(Support, "ghost")).Refusal!.Kind);

    // ── Account actions ──────────────────────────────────────────────────

    [Fact]
    public async Task Verifies_and_un_verifies_recording_both()
    {
        await _users.ApplyAsync(Admin, "u2", new AdminUserActionRequest("verify", Verified: true));
        Assert.True(await One<bool>("SELECT verified FROM users WHERE id = 'u2'"));

        await _users.ApplyAsync(Admin, "u2", new AdminUserActionRequest("verify", Verified: false));
        Assert.False(await One<bool>("SELECT verified FROM users WHERE id = 'u2'"));

        var log = await AuditFor(new AdminAuditQuery { TargetId = "u2" });
        Assert.Equal(["user.unverify", "user.verify"], log.Select(e => e.Action));
    }

    [Fact]
    public async Task Suspends_and_cuts_existing_sessions_off_at_the_same_moment()
    {
        var before = DateTimeOffset.UtcNow.AddSeconds(-1);
        await Exec(
            """
            INSERT INTO refresh_tokens (id, "userId", "tokenHash", "issuedAt", "expiresAt")
            VALUES ('rt_live', 'u2', 'hash_live', now(), now() + interval '30 days')
            """);

        var (user, refusal) = await _users.ApplyAsync(Admin, "u2", new AdminUserActionRequest("suspend", Reason: "Chargeback fraud"));

        Assert.Null(refusal);
        Assert.Equal("suspended", user!.Status);
        var (reason, from) = await One<(string, DateTimeOffset)>(
            "SELECT \"suspendedReason\", \"sessionsValidFrom\" FROM users WHERE id = 'u2'");
        Assert.Equal("Chargeback fraud", reason);
        // Without this the suspension means nothing until the cookie expires.
        Assert.True(from >= before);
        // And a native app cannot refresh its way back in.
        Assert.NotNull(await One<DateTimeOffset?>("SELECT \"revokedAt\" FROM refresh_tokens WHERE id = 'rt_live'"));
    }

    [Fact]
    public async Task Reactivates_and_clears_the_suspension_reason()
    {
        await _users.ApplyAsync(Admin, "u2", new AdminUserActionRequest("suspend", Reason: "Mistake"));
        await _users.ApplyAsync(Admin, "u2", new AdminUserActionRequest("reactivate"));

        var (status, at, reason) = await One<(string, DateTimeOffset?, string)>(
            "SELECT status, \"suspendedAt\", \"suspendedReason\" FROM users WHERE id = 'u2'");
        Assert.Equal(("active", (DateTimeOffset?)null, ""), (status, at, reason));
    }

    [Fact]
    public async Task Forces_a_sign_out_without_suspending()
    {
        await _users.ApplyAsync(Admin, "u2", new AdminUserActionRequest("sign_out"));

        var (status, from) = await One<(string, DateTimeOffset?)>(
            "SELECT status, \"sessionsValidFrom\" FROM users WHERE id = 'u2'");
        Assert.Equal("active", status);
        Assert.NotNull(from);
    }

    [Fact]
    public async Task Changes_marketplace_roles()
    {
        var (user, _) = await _users.ApplyAsync(Admin, "u2", new AdminUserActionRequest("set_roles", Roles: ["owner", "caretaker"]));
        Assert.Equal(["owner", "caretaker"], user!.Roles);
    }

    [Fact]
    public async Task Reports_a_missing_user_rather_than_throwing()
        => Assert.Equal(AdminFailure.NotFound,
            (await _users.ApplyAsync(Admin, "ghost", new AdminUserActionRequest("verify", Verified: true))).Refusal!.Kind);

    // ── Staff role changes ───────────────────────────────────────────────

    [Fact]
    public async Task Grants_and_revokes()
    {
        var (user, refusal) = await _users.ApplyAsync(Admin, "u2", new AdminUserActionRequest("set_staff_roles", StaffRoles: ["support"]));

        Assert.Null(refusal);
        Assert.Equal(["support"], user!.StaffRoles);
        Assert.True(await _core.Get<IAccessService>().HasStaffRoleAsync("u2", StaffRoles.Support));
    }

    [Fact]
    public async Task Keeps_the_legacy_isOps_column_in_step()
    {
        await _users.ApplyAsync(Admin, "u2", new AdminUserActionRequest("set_staff_roles", StaffRoles: ["ops"]));
        Assert.True(await One<bool>("SELECT \"isOps\" FROM users WHERE id = 'u2'"));

        await _users.ApplyAsync(Admin, "u2", new AdminUserActionRequest("set_staff_roles", StaffRoles: ["support"]));
        Assert.False(await One<bool>("SELECT \"isOps\" FROM users WHERE id = 'u2'"));
    }

    [Fact]
    public async Task Only_an_admin_grants_staff_roles()
    {
        // Deciding who may read customer accounts is a different decision from
        // reading one.
        var (_, refusal) = await _users.ApplyAsync(Tom, "u2", new AdminUserActionRequest("set_staff_roles", StaffRoles: ["support"]));
        Assert.Equal(AdminFailure.NotStaff, refusal!.Kind);
    }

    [Fact]
    public async Task Refuses_to_let_anyone_edit_their_own_staff_access()
    {
        // D4. Otherwise "admin" is not a role, it is a starting point.
        var (_, refusal) = await _users.ApplyAsync(Admin, AdminId,
            new AdminUserActionRequest("set_staff_roles", StaffRoles: ["admin", "finance"]));
        Assert.Equal(AdminFailure.SelfEdit, refusal!.Kind);
    }

    [Fact]
    public async Task Refuses_to_demote_the_last_admin()
    {
        // Losing every admin means nobody can grant the role back.
        await _users.ApplyAsync(Admin, "u2", new AdminUserActionRequest("set_staff_roles", StaffRoles: ["admin"]));
        var demoteOne = await _users.ApplyAsync(Admin, "u2", new AdminUserActionRequest("set_staff_roles", StaffRoles: []));
        Assert.Null(demoteOne.Refusal); // two admins existed

        await _users.ApplyAsync(Admin, "u2", new AdminUserActionRequest("set_staff_roles", StaffRoles: ["admin"]));
        var demoteOther = await _users.ApplyAsync(new StaffActor("u2"), AdminId,
            new AdminUserActionRequest("set_staff_roles", StaffRoles: []));
        Assert.Null(demoteOther.Refusal);

        // u2 is the only admin left. Nobody else is an admin to demote them,
        // and they cannot demote themselves.
        var stranded = await _users.ApplyAsync(new StaffActor("u2"), "u2",
            new AdminUserActionRequest("set_staff_roles", StaffRoles: []));
        Assert.Equal(AdminFailure.SelfEdit, stranded.Refusal!.Kind);
        Assert.Equal(1, await One<int>("SELECT count(*)::int FROM users WHERE 'admin' = ANY(\"staffRoles\")"));
    }

    [Fact]
    public async Task Two_admins_demoting_each_other_at_once_leave_one()
    {
        // The only way the last admin can actually be lost: two of them, each
        // passing the "is there another admin?" check before the other commits.
        // The check runs under a lock on the admins, so the second sees one left.
        await _users.ApplyAsync(Admin, "u2", new AdminUserActionRequest("set_staff_roles", StaffRoles: ["admin"]));

        var results = await Task.WhenAll(
            _users.ApplyAsync(Admin, "u2", new AdminUserActionRequest("set_staff_roles", StaffRoles: [])),
            _users.ApplyAsync(new StaffActor("u2"), AdminId, new AdminUserActionRequest("set_staff_roles", StaffRoles: [])));

        Assert.Single(results, r => r.Refusal is null);
        Assert.Equal(1, await One<int>("SELECT count(*)::int FROM users WHERE 'admin' = ANY(\"staffRoles\")"));
    }

    // ── Soft delete ──────────────────────────────────────────────────────

    [Fact]
    public async Task Scrubs_the_person_and_keeps_the_row()
    {
        var (_, refusal) = await _users.DeleteAsync(Admin, "u7");
        Assert.Null(refusal);

        var row = await One<(string Status, string Name, string Email, string? Hash, string Phone, string[] Roles, DateTimeOffset? From)>(
            """SELECT status, name, email, "passwordHash", phone, COALESCE(roles, '{}'), "sessionsValidFrom" FROM users WHERE id = 'u7'""");
        Assert.Equal("deleted", row.Status);
        Assert.Equal("Deleted account", row.Name);
        Assert.DoesNotContain("@example.com", row.Email);
        Assert.Null(row.Hash);
        Assert.Equal("", row.Phone);
        Assert.Empty(row.Roles);
        // And they cannot get back in on an old cookie.
        Assert.NotNull(row.From);
    }

    [Fact]
    public async Task Refuses_to_delete_yourself()
        => Assert.Equal(AdminFailure.SelfEdit, (await _users.DeleteAsync(Admin, AdminId)).Refusal!.Kind);

    [Fact]
    public async Task Only_an_admin_deletes()
        => Assert.Equal(AdminFailure.NotStaff, (await _users.DeleteAsync(Tom, "u7")).Refusal!.Kind);

    // ── Audit log ────────────────────────────────────────────────────────

    [Fact]
    public async Task Attributes_each_entry_to_the_admin_who_acted()
    {
        await _users.ApplyAsync(Admin, "u2", new AdminUserActionRequest("suspend", Reason: "Testing"));

        var entry = (await AuditFor(new AdminAuditQuery { ActorUserId = AdminId }))[0];
        Assert.Equal("user.suspend", entry.Action);
        Assert.Equal("priya.raman@example.com", entry.ActorEmail);
        Assert.Equal("Testing", entry.Metadata!.Value.GetProperty("reason").GetString());
        Assert.Equal("203.0.113.7", entry.Ip);
    }

    [Fact]
    public async Task Paginates_newest_first()
    {
        await _users.ApplyAsync(Admin, "u2", new AdminUserActionRequest("verify", Verified: true));
        await _users.ApplyAsync(Admin, "u3", new AdminUserActionRequest("verify", Verified: true));

        var (page, _) = await _audit.ListAsync(AdminId, new AdminAuditQuery { Limit = 1 });
        Assert.Single(page!.Items);
        Assert.True(page.Total >= 2);
        Assert.Equal("u3", page.Items[0].TargetId);

        var (next, _) = await _audit.ListAsync(AdminId, new AdminAuditQuery { Limit = 1, Cursor = page.NextCursor });
        Assert.Equal("u2", next!.Items[0].TargetId);
    }

    [Fact]
    public async Task Reading_the_log_is_for_admins()
        => Assert.Equal(AdminFailure.NotStaff, (await _audit.ListAsync(Support, new AdminAuditQuery())).Refusal!.Kind);

    [Fact]
    public async Task A_refused_action_writes_no_entry()
    {
        await _users.ApplyAsync(Tom, "u2", new AdminUserActionRequest("set_staff_roles", StaffRoles: ["admin"]));
        Assert.Equal(0, await One<int>("SELECT count(*)::int FROM admin_audit_log"));
    }

    // ── Settings ─────────────────────────────────────────────────────────

    [Fact]
    public async Task Returns_defaults_when_nothing_is_stored()
    {
        var (settings, _) = await _core.Get<IAdminConsoleService>().GetSettingsAsync(AdminId);
        Assert.True(settings!.SignupsOpen);
        Assert.Equal(4900, settings.FreeShippingThresholdCents);
    }

    [Fact]
    public async Task Round_trips_a_change_and_audits_it()
    {
        var console = _core.Get<IAdminConsoleService>();
        var (after, _) = await console.UpdateSettingsAsync(Admin, new SettingsPatchRequest(SignupsOpen: false, MaintenanceBanner: "Back soon"));

        Assert.False(after!.SignupsOpen);
        Assert.Equal("Back soon", after.MaintenanceBanner);
        Assert.False((await _core.Get<ISettingsService>().GetAsync()).SignupsOpen);

        var entry = Assert.Single(await AuditFor(new AdminAuditQuery { Action = "setting.update" }));
        Assert.Equal("maintenanceBanner,signupsOpen", entry.TargetId);
    }

    [Fact]
    public async Task Stores_only_the_keys_that_were_sent()
    {
        await _core.Get<IAdminConsoleService>().UpdateSettingsAsync(Admin, new SettingsPatchRequest(SignupsOpen: false));
        Assert.Equal(["signupsOpen"], (await ListKeys()).ToArray());
    }

    [Fact]
    public async Task An_unchanged_save_writes_no_audit_entry()
    {
        await _core.Get<IAdminConsoleService>().UpdateSettingsAsync(Admin, new SettingsPatchRequest(SignupsOpen: true));
        Assert.Equal(0, await One<int>("SELECT count(*)::int FROM admin_audit_log"));
    }

    [Fact]
    public async Task Falls_back_to_the_default_when_a_stored_value_is_the_wrong_type()
    {
        // A hand-edited row must not be able to crash every page that reads it.
        await Exec("""INSERT INTO system_settings (key, value, "updatedAt", "updatedBy") VALUES ('freeShippingThresholdCents', '"not a number"', now(), 'hand')""");
        Assert.Equal(4900, (await _core.Get<ISettingsService>().GetAsync()).FreeShippingThresholdCents);
    }

    [Fact]
    public async Task Settings_are_for_admins()
        => Assert.Equal(AdminFailure.NotStaff, (await _core.Get<IAdminConsoleService>().GetSettingsAsync(Support)).Refusal!.Kind);

    private async Task<IEnumerable<string>> ListKeys()
    {
        await using var conn = new NpgsqlConnection(db.ConnectionString);
        return await conn.QueryAsync<string>("SELECT key FROM system_settings ORDER BY key");
    }

    // ── Overview stats ───────────────────────────────────────────────────

    private async Task<AdminStatsDto> Stats(string caller = AdminId)
        => (await _core.Get<IAdminConsoleService>().GetStatsAsync(caller, DateTimeOffset.UtcNow)).Stats!;

    [Fact]
    public async Task Counts_what_the_page_shows()
    {
        var stats = await Stats();
        Assert.True(stats.Users.Total > 0);
        Assert.Equal(3, stats.Users.Staff);
        Assert.True(stats.Orders.Total > 0);
        Assert.True(stats.Catalog.Active > 0);
    }

    [Fact]
    public async Task Excludes_refunded_and_cancelled_orders_from_gross_value()
    {
        var before = await Stats();
        var total = await One<int>("SELECT \"totalCents\" FROM orders WHERE id = 'o1'");

        await Exec("UPDATE orders SET status = 'refunded' WHERE id = 'o1'");

        Assert.Equal(before.Orders.GrossCents - total, (await Stats()).Orders.GrossCents);
    }

    [Fact]
    public async Task Leaves_deleted_accounts_out_of_the_headline_count()
    {
        var before = await Stats();
        await _users.DeleteAsync(Admin, "u7");
        Assert.Equal(before.Users.Total - 1, (await Stats()).Users.Total);
    }

    [Fact]
    public async Task Any_staff_role_may_see_the_overview()
    {
        Assert.NotNull(await Stats(Ops));
        Assert.Equal(AdminFailure.NotStaff,
            (await _core.Get<IAdminConsoleService>().GetStatsAsync("u1", DateTimeOffset.UtcNow)).Refusal!.Kind);
    }

    // ── Professionals (V11) ──────────────────────────────────────────────

    [Fact]
    public async Task Lists_unverified_professionals_first()
    {
        var (page, _) = await _core.Get<IAdminProfessionalService>().SearchAsync(Support, new AdminProfessionalQuery { Limit = 100 });

        var ranks = page!.Items.Select(p => p.Status switch { "pending" => 0, "none" => 1, _ => 2 }).ToArray();
        Assert.Equal(ranks.Order(), ranks);
        Assert.Contains(page.Items, p => p.Kind == "caretaker");
        Assert.Contains(page.Items, p => p.Kind == "vet");
        Assert.Contains(page.Items, p => p.Kind == "shelter");
    }

    [Fact]
    public async Task Pages_professionals_without_overlap()
    {
        var service = _core.Get<IAdminProfessionalService>();
        var all = (await service.SearchAsync(Support, new AdminProfessionalQuery { Limit = 100 })).Page!;

        var seen = new List<string>();
        string? cursor = null;
        do
        {
            var page = (await service.SearchAsync(Support, new AdminProfessionalQuery { Limit = 3, Cursor = cursor })).Page!;
            seen.AddRange(page.Items.Select(p => p.Id));
            cursor = page.NextCursor;
        } while (cursor is not null);

        Assert.Equal(all.Items.Select(p => p.Id), seen);
        Assert.Equal(all.Total, seen.Count);
    }

    [Fact]
    public async Task Staff_verify_a_vet_who_is_told_and_the_badge_shows()
    {
        await Exec("UPDATE vet_profiles SET \"verificationStatus\" = 'pending' WHERE id = 'v1'");

        var refusal = await _core.Get<IAdminProfessionalService>().SetVerificationAsync(
            Tom, "v1", new AdminVerificationRequest("vet", "verified", "Licence checked with the TX board"));

        Assert.Null(refusal);
        Assert.Equal("verified", await One<string>("SELECT \"verificationStatus\" FROM vet_profiles WHERE id = 'v1'"));
        Assert.Equal(NotificationKinds.ProfileVerified,
            await One<string>("SELECT kind FROM notifications WHERE \"userId\" = 'u17'"));
        var entry = Assert.Single(await AuditFor(new AdminAuditQuery { Action = "professional.background_check" }));
        Assert.Equal("vet_profile", entry.TargetType);
    }

    [Fact]
    public async Task Verifying_a_caretaker_writes_their_background_check()
    {
        await _core.Get<IAdminProfessionalService>().SetVerificationAsync(Tom, "c1", new AdminVerificationRequest("caretaker", "pending"));
        Assert.Equal("pending", await One<string>("SELECT \"backgroundCheckStatus\" FROM caretaker_profiles WHERE id = 'c1'"));
    }

    [Fact]
    public async Task An_unknown_profile_is_not_found()
        => Assert.Equal(AdminFailure.NotFound,
            (await _core.Get<IAdminProfessionalService>().SetVerificationAsync(Tom, "v_nope", new AdminVerificationRequest("vet", "verified")))!.Kind);

    [Fact]
    public async Task Ops_cannot_verify_anyone()
        => Assert.Equal(AdminFailure.NotStaff,
            (await _core.Get<IAdminProfessionalService>().SetVerificationAsync(new StaffActor(Ops), "v1", new AdminVerificationRequest("vet", "verified")))!.Kind);

    // ── Finance ──────────────────────────────────────────────────────────

    [Fact]
    public async Task Lists_the_ledger_with_totals_over_the_filter()
    {
        var finance = _core.Get<IAdminFinanceService>();
        var (page, _) = await finance.SearchPaymentsAsync(Support, new AdminPaymentQuery { Limit = 100 });

        Assert.True(page!.Total >= 4);
        Assert.Equal(page.Items.Where(p => p.Status is "paid" or "partially_refunded" or "refunded").Sum(p => (long)p.AmountCents),
            page.CapturedCents);

        var (mine, _) = await finance.SearchPaymentsAsync(Support, new AdminPaymentQuery { Q = "maya.chen" });
        Assert.All(mine!.Items, p => Assert.Equal("u1", p.UserId));
    }

    [Fact]
    public async Task Staff_refund_part_of_an_order_and_both_views_reflect_it()
    {
        // Journey 8: the ledger and the customer's order both show the refund.
        var (result, refusal) = await _core.Get<IAdminFinanceService>().RefundAsync(
            Tom, "pay_seed_o1", new AdminRefundRequest(AmountCents: 1000, Reason: "requested_by_customer", Note: "Torn bag"));

        Assert.Null(refusal);
        Assert.Equal(1000, result!.AmountCents);
        Assert.Equal(("partially_refunded", 1000), await One<(string, int)>(
            "SELECT status, \"amountRefundedCents\" FROM payments WHERE id = 'pay_seed_o1'"));
        Assert.Equal("partially_refunded", await One<string>("SELECT \"paymentStatus\" FROM orders WHERE id = 'o1'"));
        Assert.Equal(Support, await One<string>("SELECT \"initiatedBy\" FROM refunds WHERE \"paymentId\" = 'pay_seed_o1'"));
        Assert.Single(await AuditFor(new AdminAuditQuery { Action = "payment.refund" }));
    }

    [Fact]
    public async Task Refusing_too_large_a_refund_says_how_much_is_left()
    {
        var (_, refusal) = await _core.Get<IAdminFinanceService>().RefundAsync(Tom, "pay_seed_o1", new AdminRefundRequest(AmountCents: 99_999_999));

        Assert.Equal(AdminFailure.Conflict, refusal!.Kind);
        Assert.Contains("still refundable", refusal.Message);
    }

    [Fact]
    public async Task Support_alone_cannot_move_money()
    {
        await Exec("UPDATE users SET \"staffRoles\" = '{support}' WHERE id = 'u23'");
        var (_, refusal) = await _core.Get<IAdminFinanceService>().RefundAsync(Tom, "pay_seed_o1", new AdminRefundRequest());
        Assert.Equal(AdminFailure.NotStaff, refusal!.Kind);
    }

    [Fact]
    public async Task Lists_members_with_the_monthly_figure()
    {
        var (page, _) = await _core.Get<IAdminFinanceService>().SearchSubscriptionsAsync(Support, new AdminSubscriptionQuery());

        Assert.Equal(3, page!.Total);
        Assert.Equal(1, page.ActiveCount);
        Assert.Equal(999, page.MrrCents);
    }

    [Fact]
    public async Task Cancels_at_period_end_resumes_and_extends_grace()
    {
        var finance = _core.Get<IAdminFinanceService>();

        Assert.Null(await finance.ApplySubscriptionActionAsync(Tom, "sub_seed_active", new AdminSubscriptionActionRequest("cancel")));
        Assert.True(await One<bool>("SELECT \"cancelAtPeriodEnd\" FROM subscriptions WHERE id = 'sub_seed_active'"));

        Assert.Null(await finance.ApplySubscriptionActionAsync(Tom, "sub_seed_active", new AdminSubscriptionActionRequest("resume")));
        Assert.False(await One<bool>("SELECT \"cancelAtPeriodEnd\" FROM subscriptions WHERE id = 'sub_seed_active'"));

        var grace = await One<DateTimeOffset>("SELECT \"graceEndsAt\" FROM subscriptions WHERE id = 'sub_seed_past_due'");
        Assert.Null(await finance.ApplySubscriptionActionAsync(Tom, "sub_seed_past_due", new AdminSubscriptionActionRequest("extend_grace", Days: 5)));
        Assert.Equal(grace.AddDays(5), await One<DateTimeOffset>("SELECT \"graceEndsAt\" FROM subscriptions WHERE id = 'sub_seed_past_due'"));

        Assert.Equal(["subscription.grace_extend", "subscription.resume", "subscription.cancel"],
            (await AuditFor(new AdminAuditQuery { TargetType = "subscription" })).Select(e => e.Action));
    }

    [Fact]
    public async Task Cancelling_immediately_ends_the_benefits_now()
    {
        await _core.Get<IAdminFinanceService>().ApplySubscriptionActionAsync(
            Tom, "sub_seed_active", new AdminSubscriptionActionRequest("cancel", Immediately: true));

        Assert.False((await _core.Get<IEntitlementService>().GetMembershipAsync("u5")).Active);
        Assert.Contains(NotificationKinds.MembershipEnded,
            await One<string>("SELECT string_agg(kind, ',') FROM notifications WHERE \"userId\" = 'u5'"));
    }

    [Fact]
    public async Task Resuming_needs_a_scheduled_cancellation()
        => Assert.Equal(AdminFailure.Conflict,
            (await _core.Get<IAdminFinanceService>().ApplySubscriptionActionAsync(Tom, "sub_seed_active", new AdminSubscriptionActionRequest("resume")))!.Kind);
}

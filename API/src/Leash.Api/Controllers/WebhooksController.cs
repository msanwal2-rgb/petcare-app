using System.Text;
using Leash.Api.Http;
using Leash.Core.Payments;
using Microsoft.AspNetCore.Mvc;

namespace Leash.Api.Controllers;

/// <summary>
/// Stripe's webhook endpoint (REQUIREMENTS.md M6, M7).
///
/// Unauthenticated by design — the signature is the gate, and there is no
/// <c>[Authorize]</c> to put on it. Also the one action that must <b>never
/// bind its body</b>: the signature is computed over the exact bytes Stripe
/// sent, and model binding would parse and the bytes would be gone. So the raw
/// body is read as a string, verified, and only then looked at — all of it in
/// <see cref="IStripeWebhookIntake"/>.
///
/// Register the production URL in Stripe's dashboard:
/// <c>https://&lt;api&gt;/api/v1/webhooks/stripe</c>, with
/// <c>Payments:Stripe:WebhookSecret</c> set to its signing secret.
/// </summary>
[ApiController]
[Route("api/v1/webhooks")]
public sealed class WebhooksController(IStripeWebhookIntake intake) : ControllerBase
{
    /// <summary>Stripe events are small; anything near this is not one.</summary>
    private const int MaxBodyBytes = 512 * 1024;

    [HttpPost("stripe")]
    [RequestSizeLimit(MaxBodyBytes)]
    public async Task<IActionResult> Stripe(CancellationToken ct)
    {
        using var reader = new StreamReader(Request.Body, Encoding.UTF8);
        var payload = await reader.ReadToEndAsync(ct);
        var signature = Request.Headers["Stripe-Signature"].FirstOrDefault();

        var result = await intake.ReceiveAsync(payload, signature, ct);

        return result.Status switch
        {
            // Fails closed: 403 for everything until a secret is configured.
            WebhookIntakeStatus.NotConfigured => ApiResults.Forbidden("This endpoint is not configured"),
            WebhookIntakeStatus.Unsigned => ApiResults.BadRequest("Unsigned"),
            WebhookIntakeStatus.BadSignature => ApiResults.BadRequest("Invalid signature"),

            // Done, or never going to be: Stripe should stop resending.
            WebhookIntakeStatus.Processed => Ok(new { received = true, effect = result.Detail }),
            WebhookIntakeStatus.Skipped => Ok(new { received = true, skipped = result.Detail }),
            WebhookIntakeStatus.Duplicate or WebhookIntakeStatus.Exhausted =>
                Ok(new { received = true, claim = result.Detail }),

            // Somebody else has it, or it failed for a reason a retry may fix.
            WebhookIntakeStatus.InFlight => StatusCode(StatusCodes.Status500InternalServerError,
                new { error = "Already processing" }),
            _ => StatusCode(StatusCodes.Status500InternalServerError, new { error = "Handler failed" }),
        };
    }
}

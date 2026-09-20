using FluentValidation;
using Leash.Api.Http;
using Microsoft.AspNetCore.Mvc.Filters;

namespace Leash.Api.Filters;

/// <summary>
/// Validates every action argument that has a registered
/// <see cref="IValidator{T}"/>, before the action body runs.
///
/// This is the C# half of the reference project's
/// <c>parseBody(request, schema)</c>. Two properties of that helper are
/// reproduced exactly, because the frontend depends on both:
///
///  - the envelope is
///    <c>{ error: "Validation failed", issues: [{ path, message }] }</c>, and
///    <c>path</c> is the dotted field path the form maps back to an input
///    (<c>items.0.quantity</c>, not <c>Items[0].Quantity</c>);
///  - validation happens before anything else, so an action can assume its
///    arguments are well-formed and does not re-check.
///
/// Registered globally rather than per action. The alternative — an attribute
/// each controller remembers to add — fails silently the first time somebody
/// forgets, and a missing validation is not the kind of bug that announces
/// itself. Actions whose arguments have no validator are unaffected.
/// </summary>
public sealed class ValidationActionFilter(IServiceProvider services) : IAsyncActionFilter
{
    public async Task OnActionExecutionAsync(
        ActionExecutingContext context, ActionExecutionDelegate next)
    {
        // Model binding failed outright — malformed JSON, or a body that is not
        // an object at all. Same status as a validation failure, different
        // message, because "Validation failed" with no issues reads like a bug
        // in the form rather than a bad request.
        if (!context.ModelState.IsValid &&
            context.ModelState.Values.Any(v => v.Errors.Any(e => e.Exception is not null)))
        {
            context.Result = ApiResults.BadRequest("Invalid JSON body");
            return;
        }

        var issues = new List<ApiResults.Issue>();

        foreach (var argument in context.ActionArguments.Values)
        {
            if (argument is null) continue;

            // Resolved by closed generic type, so only bodies with a validator
            // registered in Leash.Core are checked.
            var validatorType = typeof(IValidator<>).MakeGenericType(argument.GetType());
            if (services.GetService(validatorType) is not IValidator validator) continue;

            var contextType = typeof(ValidationContext<>).MakeGenericType(argument.GetType());
            var validationContext = (IValidationContext)Activator.CreateInstance(
                contextType, argument)!;

            var result = await validator.ValidateAsync(
                validationContext, context.HttpContext.RequestAborted);

            if (!result.IsValid)
                issues.AddRange(result.Errors.Select(e =>
                    new ApiResults.Issue(Camel(e.PropertyName), e.ErrorMessage)));
        }

        if (issues.Count > 0)
        {
            context.Result = ApiResults.ValidationFailed(issues);
            return;
        }

        await next();
    }

    /// <summary>
    /// FluentValidation reports C# property paths (<c>Items[0].Quantity</c>);
    /// the client speaks the JSON contract (<c>items[0].quantity</c>). The
    /// translation lives here so no validator has to think about it.
    /// </summary>
    private static string Camel(string path)
    {
        if (string.IsNullOrEmpty(path)) return path;

        var segments = path.Split('.', StringSplitOptions.RemoveEmptyEntries);

        return string.Join('.', segments.Select(segment =>
        {
            // An indexer stays attached to the property it indexes, so
            // "Roles[0]" becomes "roles[0]" rather than "roles.0".
            var bracket = segment.IndexOf('[');
            if (bracket <= 0)
                return char.IsLetter(segment[0])
                    ? char.ToLowerInvariant(segment[0]) + segment[1..]
                    : segment;

            var name = segment[..bracket];
            return char.ToLowerInvariant(name[0]) + name[1..] + segment[bracket..];
        }));
    }
}

using Telegram.Bot;
using Telegram.Bot.Exceptions;
using Telegram.Bot.Types.Enums;

namespace TeslaHub.Api.Services;

/// <summary>
/// Sends notifications to a Telegram chat ID via a personal bot token
/// configured by the user (TELEGRAM_BOT_TOKEN env var). The bot is
/// fully self-hosted: TeslaHub talks directly to api.telegram.org with
/// no intermediate service.
/// </summary>
public sealed class TelegramNotificationService
{
    private readonly ILogger<TelegramNotificationService> _logger;
    private readonly ITelegramBotClient? _client;

    public TelegramNotificationService(IConfiguration configuration, ILogger<TelegramNotificationService> logger)
    {
        _logger = logger;
        var token = configuration["TELEGRAM_BOT_TOKEN"];
        _client = string.IsNullOrWhiteSpace(token) ? null : new TelegramBotClient(token);
    }

    public bool IsConfigured => _client is not null;

    public async Task<TelegramSendResult> SendAsync(string chatId, string message, CancellationToken cancellationToken)
    {
        if (_client is null)
            return TelegramSendResult.Fail(
                "TELEGRAM_BOT_TOKEN is not set on this TeslaHub instance.",
                TelegramFailureKind.NotConfigured);

        if (string.IsNullOrWhiteSpace(chatId))
            return TelegramSendResult.Fail("Chat ID is empty.", TelegramFailureKind.InvalidRecipient);

        try
        {
            await _client.SendMessage(
                chatId: chatId,
                text: message,
                parseMode: ParseMode.Html,
                cancellationToken: cancellationToken);
            return TelegramSendResult.Ok();
        }
        catch (ApiRequestException ex)
        {
            // Telegram answered with an explicit Bot API error. Most of the
            // time these are caused by the destination chat (user has not
            // started the bot yet, blocked it, wrong chat id…). We surface
            // them as recipient-side problems so the UI can give actionable
            // guidance rather than a generic "502 Bad Gateway".
            var kind = ClassifyApiError(ex);
            var detail = BuildRecipientErrorDetail(ex, kind);
            _logger.LogWarning(ex,
                "Telegram API rejected message for chat {ChatId} ({Kind}, code {Code}): {Description}",
                chatId, kind, ex.ErrorCode, ex.Message);
            return TelegramSendResult.Fail(detail, kind);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Telegram send failed for chat {ChatId}", chatId);
            return TelegramSendResult.Fail(ex.Message, TelegramFailureKind.Transport);
        }
    }

    private static TelegramFailureKind ClassifyApiError(ApiRequestException ex)
    {
        var description = ex.Message ?? string.Empty;
        if (ex.ErrorCode == 403)
            return TelegramFailureKind.RecipientNotReachable;

        if (ex.ErrorCode == 400)
        {
            if (description.Contains("chat not found", StringComparison.OrdinalIgnoreCase) ||
                description.Contains("user not found", StringComparison.OrdinalIgnoreCase) ||
                description.Contains("PEER_ID_INVALID", StringComparison.OrdinalIgnoreCase))
                return TelegramFailureKind.InvalidRecipient;
        }

        return TelegramFailureKind.Telegram;
    }

    private static string BuildRecipientErrorDetail(ApiRequestException ex, TelegramFailureKind kind) => kind switch
    {
        TelegramFailureKind.RecipientNotReachable =>
            "Telegram refused the message because this user has not started a chat with the bot yet "
            + "(or has blocked it). Ask the recipient to open Telegram, search for your TeslaHub bot "
            + "and press Start, then retry. "
            + $"(Telegram said: {ex.Message})",

        TelegramFailureKind.InvalidRecipient =>
            "Telegram could not find this chat. Double-check the numeric chat ID — it must come from "
            + "the same person's account, after they have sent /start to your TeslaHub bot. "
            + $"(Telegram said: {ex.Message})",

        _ => $"Telegram error {ex.ErrorCode}: {ex.Message}",
    };
}

public enum TelegramFailureKind
{
    None = 0,
    NotConfigured,
    InvalidRecipient,
    RecipientNotReachable,
    Telegram,
    Transport,
}

public sealed record TelegramSendResult(bool Success, string? Error, TelegramFailureKind FailureKind)
{
    public static TelegramSendResult Ok() => new(true, null, TelegramFailureKind.None);
    public static TelegramSendResult Fail(string error, TelegramFailureKind kind) => new(false, error, kind);
}

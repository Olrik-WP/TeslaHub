using Telegram.Bot;
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
            return new TelegramSendResult(false, "TELEGRAM_BOT_TOKEN is not set on this TeslaHub instance.");

        if (string.IsNullOrWhiteSpace(chatId))
            return new TelegramSendResult(false, "Chat ID is empty.");

        try
        {
            await _client.SendMessage(
                chatId: chatId,
                text: message,
                parseMode: ParseMode.Html,
                cancellationToken: cancellationToken);
            return new TelegramSendResult(true, null);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Telegram send failed for chat {ChatId}", chatId);
            return new TelegramSendResult(false, ex.Message);
        }
    }
}

public record TelegramSendResult(bool Success, string? Error);

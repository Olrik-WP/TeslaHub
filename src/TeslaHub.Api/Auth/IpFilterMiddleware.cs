using System.Net;

namespace TeslaHub.Api.Auth;

public class IpFilterMiddleware
{
    private readonly RequestDelegate _next;
    private readonly HashSet<IPNetwork>? _allowedNetworks;

    public IpFilterMiddleware(RequestDelegate next, IConfiguration config)
    {
        _next = next;

        var allowedIps = config["TESLAHUB_ALLOWED_IPS"];
        if (!string.IsNullOrWhiteSpace(allowedIps))
        {
            _allowedNetworks = new HashSet<IPNetwork>();
            foreach (var entry in allowedIps.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            {
                if (IPNetwork.TryParse(entry, out var network))
                {
                    _allowedNetworks.Add(network);
                }
            }

            if (_allowedNetworks.Count == 0)
                _allowedNetworks = null;
        }
    }

    public async Task InvokeAsync(HttpContext context)
    {
        if (_allowedNetworks == null)
        {
            await _next(context);
            return;
        }

        var remoteIp = context.Connection.RemoteIpAddress;
        if (remoteIp == null)
        {
            context.Response.StatusCode = 403;
            await context.Response.WriteAsync("Forbidden");
            return;
        }

        if (IPAddress.IsLoopback(remoteIp))
        {
            await _next(context);
            return;
        }

        var allowed = false;
        foreach (var network in _allowedNetworks)
        {
            if (network.Contains(remoteIp))
            {
                allowed = true;
                break;
            }
        }

        if (!allowed)
        {
            context.Response.StatusCode = 403;
            await context.Response.WriteAsync("Forbidden — IP not allowed");
            return;
        }

        await _next(context);
    }
}

"""TLS that works on Windows too, without ever turning certificate checks off.

Python on Windows trusts the root certificates already in the Windows store, but Windows only downloads a root
the first time Windows itself needs it. Greek university servers (HARICA certificates) are often rejected for
that reason alone. When that happens, Windows is asked to check the server once (which downloads the root the
normal way) and the store is read again.
"""
import os
import re
import ssl
import subprocess
import threading

HOST_RE = re.compile(r"[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?")
_tried, _lock = set(), threading.Lock()


def make_context():
    """The OS's own certificate checks through `truststore` when it's installed, else Python's default."""
    try:
        import truststore
        return truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT), "truststore"
    except Exception:
        return ssl.create_default_context(), "python"


def warm_windows_roots(host, port, timeout=25):
    """Has Windows verify host:port once with its own TLS, so it fetches a missing root. Windows only."""
    if os.name != "nt" or not HOST_RE.fullmatch(host or "") or not isinstance(port, int):
        return False
    script = ("$c = New-Object Net.Sockets.TcpClient; try { $c.Connect('%s', %d); "
              "$s = New-Object Net.Security.SslStream($c.GetStream()); $s.AuthenticateAsClient('%s') } "
              "catch {} finally { $c.Close() }") % (host, port, host)
    try:
        subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", script], capture_output=True,
                       timeout=timeout, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    except (OSError, subprocess.SubprocessError):
        return False
    return True


def recover(context, host, port):
    """After a certificate error: once per server, let Windows fetch its root, then reload the store.
    Returns True when it is worth trying the connection again."""
    with _lock:
        if (host, port) in _tried:
            return False
        _tried.add((host, port))
    if not isinstance(context, ssl.SSLContext) or type(context).__module__.startswith("truststore"):
        return False
    if not warm_windows_roots(host, port):
        return False
    context.load_default_certs()
    return True


def is_cert_error(error):
    while error is not None:
        if isinstance(error, ssl.SSLCertVerificationError):
            return True
        error = getattr(error, "reason", None) or error.__cause__ or error.__context__
        if isinstance(error, str):
            return False
    return False


def explain(error, host):
    """What a certificate error most likely means on this computer, and what to do."""
    reason = ""
    e = error
    while e is not None and not reason:
        reason = getattr(e, "verify_message", "") or ""
        e = getattr(e, "reason", None) if not isinstance(getattr(e, "reason", None), str) else None
    reason = reason or str(error)
    if "expired" in reason or "not yet valid" in reason:
        hint = "Check that this computer's date, time and time zone are correct."
    elif "self-signed certificate in certificate chain" in reason or "self signed certificate in certificate chain" in reason:
        hint = ("Something on this computer or network replaces the server's certificate: usually antivirus "
                "'scan secure connections / mail shield' (Avast, AVG, ESET, Kaspersky…) or a company network. "
                "Turn off its scanning of encrypted mail/web connections, or try another network.")
    elif os.name == "nt":
        hint = ("Windows doesn't have the root certificate of this server yet. Install truststore so Student Hub "
                "uses Windows' own checks: py -3 -m pip install truststore, then restart Student Hub. "
                "Opening https://" + host + " once in Edge can also add it.")
    else:
        hint = "Update this computer's root certificates (e.g. the ca-certificates package)."
    return f"The certificate of {host} could not be verified ({reason}). {hint}"

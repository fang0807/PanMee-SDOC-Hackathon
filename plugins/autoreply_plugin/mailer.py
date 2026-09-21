"""SMTP transport for the standalone Auto Reply plugin."""

from __future__ import annotations

import os
import smtplib
import ssl
from dataclasses import dataclass
from email.message import EmailMessage


@dataclass(frozen=True)
class SMTPConfig:
    host: str
    port: int
    username: str
    password: str
    from_address: str
    use_ssl: bool = True
    use_starttls: bool = False

    @classmethod
    def from_env(cls) -> "SMTPConfig":
        host = os.getenv("AUTOREPLY_SMTP_HOST", "smtp.gmail.com").strip()
        port = int(os.getenv("AUTOREPLY_SMTP_PORT", "465"))
        username = os.getenv("AUTOREPLY_SMTP_USERNAME", "").strip()
        password = os.getenv("AUTOREPLY_SMTP_PASSWORD", "")
        from_address = os.getenv("AUTOREPLY_FROM_ADDRESS", username).strip()
        use_ssl = os.getenv("AUTOREPLY_SMTP_SSL", "1").strip().lower() not in {
            "0", "false", "no", "off"
        }
        use_starttls = os.getenv("AUTOREPLY_SMTP_STARTTLS", "0").strip().lower() in {
            "1", "true", "yes", "on"
        }

        missing = [
            name
            for name, value in {
                "AUTOREPLY_SMTP_USERNAME": username,
                "AUTOREPLY_SMTP_PASSWORD": password,
                "AUTOREPLY_FROM_ADDRESS": from_address,
            }.items()
            if not value
        ]
        if missing:
            raise RuntimeError(
                "Missing SMTP configuration: " + ", ".join(missing)
            )

        return cls(
            host=host,
            port=port,
            username=username,
            password=password,
            from_address=from_address,
            use_ssl=use_ssl,
            use_starttls=use_starttls,
        )


class SMTPMailer:
    def __init__(self, config: SMTPConfig):
        self.config = config

    def send(self, recipient: str, subject: str, body: str) -> None:
        msg = EmailMessage()
        msg["From"] = self.config.from_address
        msg["To"] = recipient
        msg["Subject"] = subject
        msg.set_content(body)

        context = ssl.create_default_context()

        if self.config.use_ssl:
            with smtplib.SMTP_SSL(
                self.config.host,
                self.config.port,
                context=context,
                timeout=30,
            ) as server:
                server.login(self.config.username, self.config.password)
                server.send_message(msg)
            return

        with smtplib.SMTP(self.config.host, self.config.port, timeout=30) as server:
            server.ehlo()
            if self.config.use_starttls:
                server.starttls(context=context)
                server.ehlo()
            server.login(self.config.username, self.config.password)
            server.send_message(msg)

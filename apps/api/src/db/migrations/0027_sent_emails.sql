-- sent_emails: durable receipt log for outbound transactional emails.
--
-- Today there's a single use case: the on-finalize round-results email to
-- Jason. Container logs evaporate on every redeploy, so without this table
-- we can't answer "did the email fire?" without crawling the sender's Sent
-- folder. Each row captures what was sent, to whom, and the SMTP response.
--
-- round_id is nullable for future non-round emails (alerts, weekly digests,
-- etc.). Failures are logged with status='failed' and error_message; a row
-- always exists per attempt regardless of SMTP outcome.

CREATE TABLE `sent_emails` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `round_id` integer,
  `kind` text NOT NULL,
  `subject` text NOT NULL,
  `recipients` text NOT NULL,
  `status` text NOT NULL,
  `accepted_count` integer NOT NULL DEFAULT 0,
  `rejected_count` integer NOT NULL DEFAULT 0,
  `error_message` text,
  `context_id` text NOT NULL DEFAULT 'league:guyan-wolf-cup-friday',
  `tenant_id` text NOT NULL DEFAULT 'guyan',
  `sent_at` integer NOT NULL,
  CONSTRAINT `chk_sent_emails_status` CHECK (status IN ('sent', 'failed')),
  FOREIGN KEY (`round_id`) REFERENCES `rounds`(`id`)
);

CREATE INDEX `idx_sent_emails_round_id` ON `sent_emails` (`round_id`);
CREATE INDEX `idx_sent_emails_sent_at` ON `sent_emails` (`sent_at`);

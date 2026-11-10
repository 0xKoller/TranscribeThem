import Foundation

public enum ActivityHistory {
    /// Keeps jobs whose transcript or site matches `query`.
    /// Comparison is case and diacritic insensitive. An empty query returns every job.
    /// `siteLabel` is included so a localized name such as "WhatsApp" matches too.
    public static func filter(
        _ jobs: [JobRecord],
        query: String,
        siteLabel: (String) -> String = { $0 }
    ) -> [JobRecord] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return jobs }
        return jobs.filter { job in
            contains(job.site, trimmed)
                || contains(siteLabel(job.site), trimmed)
                || contains(job.transcript ?? "", trimmed)
        }
    }

    public static func exportable(_ jobs: [JobRecord]) -> [JobRecord] {
        jobs.filter { transcriptText($0) != nil }
    }

    /// Plain text with one block per entry that has a transcript: date, site, then the text.
    public static func exportText(
        _ jobs: [JobRecord],
        formatDate: (Date) -> String,
        siteLabel: (String) -> String = { $0 }
    ) -> String {
        exportable(jobs).map { job in
            let transcript = transcriptText(job) ?? ""
            return "\(formatDate(job.at))\n\(siteLabel(job.site))\n\(transcript)"
        }.joined(separator: "\n\n")
    }

    private static func transcriptText(_ job: JobRecord) -> String? {
        guard let transcript = job.transcript?.trimmingCharacters(in: .whitespacesAndNewlines),
              !transcript.isEmpty else { return nil }
        return transcript
    }

    private static func contains(_ value: String, _ query: String) -> Bool {
        value.localizedStandardContains(query)
    }
}

public enum BundleVersion {
    public static func shortString(infoValue: String?) -> String {
        let trimmed = infoValue?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? "dev" : trimmed
    }

    public static func current(_ bundle: Bundle = .main) -> String {
        shortString(infoValue: bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String)
    }
}

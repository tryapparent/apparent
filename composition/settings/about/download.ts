const feedUrl =
  "https://raw.githubusercontent.com/tryapparent/apparent/preview-mac-feed/nightly.xml";

export async function nightlyDownload(request = fetch): Promise<string> {
  const response = await request(feedUrl, {
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw Error("Nightly feed unavailable");
  const feed = await response.text();
  const item = feed.match(/<item>([^]*?)<\/item>/)?.[1];
  const link = item?.match(/<link>([^<]+)<\/link>/)?.[1];
  if (
    !link ||
    !/^https:\/\/github\.com\/tryapparent\/apparent\/releases\/download\/linux-main-v2-[a-f0-9]{40}\/Apparent-Nightly-\d+\.\d+\.\d+-arm64\.dmg$/.test(
      link,
    )
  )
    throw Error("Nightly installer unavailable");
  return link;
}

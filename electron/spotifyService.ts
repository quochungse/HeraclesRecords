import { BrowserWindow } from "electron";
import crypto from "node:crypto";
import fs from "node:fs";
import https from "node:https";
import type { AddressInfo } from "node:net";
import path from "node:path";
import SpotifyWebApi from "spotify-web-api-node";
import {
  deleteSettings,
  getSetting,
  getSpotifySyncTrack,
  listSpotifySyncTracks,
  markDownloadTransferred,
  setSetting,
  upsertSpotifySyncTrack
} from "./database";
import { getSecretSetting, setSecretSetting } from "./secretSettings";
import { downloadAudioSearch } from "./downloadService";
import { transferFileToWatch } from "./watchService";
import {
  SPOTIFY_OAUTH_CALLBACK_PORT,
  SPOTIFY_OAUTH_TLS_CREDENTIALS
} from "./spotifyOAuthTls";
import type {
  LocalTrack,
  SpotifyConfig,
  SpotifyPlaylist,
  SpotifyPlaylistTrack,
  SpotifyStatus,
  SpotifySyncResult,
  SpotifySyncTrack,
  SpotifySyncUpdate
} from "./types";

const REDIRECT_URI = `https://127.0.0.1:${SPOTIFY_OAUTH_CALLBACK_PORT}/callback`;
const SCOPES = [
  "playlist-read-private",
  "playlist-read-collaborative",
  "user-read-private"
];

const SETTINGS = {
  clientId: "spotify.clientId",
  clientSecret: "spotify.clientSecret",
  accessToken: "spotify.accessToken",
  refreshToken: "spotify.refreshToken",
  expiresAt: "spotify.expiresAt",
  userId: "spotify.userId",
  displayName: "spotify.displayName"
};

export function getSpotifyConfig(): SpotifyConfig {
  return {
    clientId: getSetting(SETTINGS.clientId) ?? "",
    clientSecret: getSecretSetting(SETTINGS.clientSecret) ?? "",
    redirectUri: REDIRECT_URI
  };
}

export function saveSpotifyConfig(config: SpotifyConfig): SpotifyStatus {
  const previous = getSpotifyConfig();
  const clientId = config.clientId.trim();
  const clientSecret = config.clientSecret.trim();

  setSetting(SETTINGS.clientId, clientId);
  setSecretSetting(SETTINGS.clientSecret, clientSecret);

  if (
    previous.clientId !== clientId ||
    previous.clientSecret !== clientSecret
  ) {
    clearSpotifyTokens();
  }

  return getSpotifyStatus();
}

export function getSpotifyStatus(): SpotifyStatus {
  const config = getSpotifyConfig();
  const expiresAt = getSetting(SETTINGS.expiresAt);
  const refreshToken = getSecretSetting(SETTINGS.refreshToken);

  return {
    configured: Boolean(config.clientId && config.clientSecret),
    authenticated: Boolean(refreshToken),
    redirectUri: REDIRECT_URI,
    displayName: getSetting(SETTINGS.displayName),
    userId: getSetting(SETTINGS.userId),
    tokenExpiresAt: expiresAt
      ? new Date(Number(expiresAt)).toISOString()
      : undefined
  };
}

export function logoutSpotify(): SpotifyStatus {
  clearSpotifyTokens();
  return getSpotifyStatus();
}

export async function loginSpotify(
  parentWindow?: BrowserWindow
): Promise<SpotifyStatus> {
  const api = createConfiguredApi();
  const state = crypto.randomBytes(18).toString("hex");
  const authUrl = api.createAuthorizeURL(SCOPES, state, true);
  const code = await waitForAuthorizationCode(authUrl, state, parentWindow);
  const authorization = await api.authorizationCodeGrant(code);

  setSecretSetting(SETTINGS.accessToken, authorization.body.access_token);
  setSecretSetting(SETTINGS.refreshToken, authorization.body.refresh_token);
  setSetting(
    SETTINGS.expiresAt,
    String(Date.now() + authorization.body.expires_in * 1000)
  );

  api.setAccessToken(authorization.body.access_token);
  api.setRefreshToken(authorization.body.refresh_token);

  const profile = await api.getMe();
  setSetting(SETTINGS.userId, profile.body.id);
  setSetting(
    SETTINGS.displayName,
    profile.body.display_name || profile.body.id
  );

  return getSpotifyStatus();
}

function pickImageUrl(
  images: SpotifyApi.ImageObject[] | undefined,
  edge: "largest" | "smallest"
): string | undefined {
  if (!images || images.length === 0) {
    return undefined;
  }

  const withDimensions = images.filter((image) => Boolean(image?.url));
  if (withDimensions.length === 0) {
    return undefined;
  }

  const sorted = [...withDimensions].sort(
    (left, right) => (right.width ?? 0) - (left.width ?? 0)
  );
  const chosen = edge === "largest" ? sorted[0] : sorted[sorted.length - 1];
  return chosen.url;
}

function largestImageUrl(
  images: SpotifyApi.ImageObject[] | undefined
): string | undefined {
  return pickImageUrl(images, "largest");
}

function smallestImageUrl(
  images: SpotifyApi.ImageObject[] | undefined
): string | undefined {
  return pickImageUrl(images, "smallest");
}

export async function listSpotifyPlaylists(): Promise<SpotifyPlaylist[]> {
  const api = await getAuthorizedSpotifyApi();
  const profile = await api.getMe();
  const userId = profile.body.id;
  const playlists: SpotifyPlaylist[] = [];
  let offset = 0;

  while (true) {
    const response = await api.getUserPlaylists({
      limit: 50,
      offset
    });

    for (const playlist of response.body.items) {
      const playlistLike = playlist as SpotifyApi.PlaylistObjectSimplified & {
        items?: { total?: number };
      };
      playlists.push({
        id: playlist.id,
        name: playlist.name,
        ownerId: playlist.owner.id,
        ownerName: playlist.owner.display_name || playlist.owner.id,
        collaborative: playlist.collaborative,
        public: playlist.public,
        totalTracks: playlistLike.items?.total ?? playlist.tracks?.total ?? 0,
        snapshotId: playlist.snapshot_id,
        syncable: playlist.owner.id === userId || playlist.collaborative,
        description: playlist.description || undefined,
        artworkUrl: largestImageUrl(playlist.images),
        url: playlist.external_urls?.spotify
      });
    }

    offset += response.body.items.length;
    if (!response.body.next || response.body.items.length === 0) {
      break;
    }
  }

  return playlists.sort((left, right) => left.name.localeCompare(right.name));
}

export async function listSpotifyPlaylistTracks(
  playlistId: string
): Promise<SpotifyPlaylistTrack[]> {
  const api = await getAuthorizedSpotifyApi();
  const tracks: SpotifyPlaylistTrack[] = [];
  let offset = 0;

  while (true) {
    const response = await spotifyGet<SpotifyPlaylistItemsResponse>(api, `/v1/playlists/${playlistId}/items`, {
      limit: 100,
      offset
    });

    for (const item of response.items) {
      const track = item.item ?? item.track;
      if (!track || track.type !== "track" || !track.id) {
        continue;
      }

      const artistName =
        track.artists.map((artist) => artist.name).join(", ") || "Unknown Artist";
      const trackName = track.name;

      tracks.push({
        spotifyTrackId: track.id,
        artistName,
        trackName,
        albumName: track.album?.name,
        durationMs: track.duration_ms,
        addedAt: item.added_at,
        filename: `${sanitizeFileBaseName(`${artistName} - ${trackName}`)}.mp3`,
        query: `${artistName} ${trackName} official audio`,
        artworkUrl: smallestImageUrl(track.album?.images)
      });
    }

    offset += response.items.length;
    if (!response.next || response.items.length === 0) {
      break;
    }
  }

  return tracks;
}

export function listSpotifySyncState(playlistId: string): SpotifySyncTrack[] {
  return listSpotifySyncTracks(playlistId);
}

export async function syncSpotifyPlaylist(
  playlistId: string,
  autoTransfer: boolean,
  onUpdate: (update: SpotifySyncUpdate) => void
): Promise<SpotifySyncResult> {
  const tracks = await listSpotifyPlaylistTracks(playlistId);
  let completed = 0;
  let failed = 0;

  for (const track of tracks) {
    const existing = getSpotifySyncTrack(playlistId, track.spotifyTrackId);
    const existingFileStillExists =
      existing?.filePath && fs.existsSync(existing.filePath);

    if (existing?.status === "done" && existingFileStillExists) {
      const current = upsertSpotifySyncTrack({
        ...existing,
        artistName: track.artistName,
        trackName: track.trackName,
        query: track.query,
        filename: track.filename
      });
      onUpdate(current);
      completed += 1;
      continue;
    }

    emitSyncUpdate(
      {
        playlistId,
        spotifyTrackId: track.spotifyTrackId,
        artistName: track.artistName,
        trackName: track.trackName,
        query: track.query,
        filename: track.filename,
        status: "queued"
      },
      onUpdate
    );

    emitSyncUpdate(
      {
        playlistId,
        spotifyTrackId: track.spotifyTrackId,
        artistName: track.artistName,
        trackName: track.trackName,
        query: track.query,
        filename: track.filename,
        status: "downloading"
      },
      onUpdate
    );

    try {
      const sourceUrl = `spotify:${playlistId}:${track.spotifyTrackId}`;
      const result = await downloadAudioSearch(
        track.query,
        path.basename(track.filename, ".mp3"),
        sourceUrl
      );
      const downloadedTrack = firstDownloadedTrack(result.tracks);

      if (autoTransfer) {
        await transferFileToWatch(downloadedTrack.filePath);
        markDownloadTransferred(downloadedTrack.id);
      }

      emitSyncUpdate(
        {
          playlistId,
          spotifyTrackId: track.spotifyTrackId,
          artistName: track.artistName,
          trackName: track.trackName,
          query: track.query,
          filename: path.basename(downloadedTrack.filePath),
          status: "done",
          localDownloadId: downloadedTrack.id,
          filePath: downloadedTrack.filePath
        },
        onUpdate
      );
      completed += 1;
    } catch (error) {
      emitSyncUpdate(
        {
          playlistId,
          spotifyTrackId: track.spotifyTrackId,
          artistName: track.artistName,
          trackName: track.trackName,
          query: track.query,
          filename: track.filename,
          status: "failed",
          error: error instanceof Error ? error.message : String(error)
        },
        onUpdate
      );
      failed += 1;
    }
  }

  return {
    playlistId,
    tracks: listSpotifySyncTracks(playlistId),
    completed,
    failed
  };
}

function emitSyncUpdate(
  track: Omit<SpotifySyncTrack, "updatedAt">,
  onUpdate: (update: SpotifySyncUpdate) => void
): void {
  onUpdate(upsertSpotifySyncTrack(track));
}

function firstDownloadedTrack(tracks: LocalTrack[]): LocalTrack {
  const track = tracks[0];
  if (!track) {
    throw new Error("No MP3 file was downloaded.");
  }

  return track;
}

async function getAuthorizedSpotifyApi(): Promise<SpotifyWebApi> {
  const api = createConfiguredApi();
  const accessToken = getSecretSetting(SETTINGS.accessToken);
  const refreshToken = getSecretSetting(SETTINGS.refreshToken);
  const expiresAt = Number(getSetting(SETTINGS.expiresAt) ?? 0);

  if (!refreshToken) {
    throw new Error("Log in to Spotify first.");
  }

  api.setRefreshToken(refreshToken);

  if (accessToken && expiresAt > Date.now() + 60_000) {
    api.setAccessToken(accessToken);
    return api;
  }

  const refreshed = await api.refreshAccessToken();
  api.setAccessToken(refreshed.body.access_token);
  setSecretSetting(SETTINGS.accessToken, refreshed.body.access_token);
  setSetting(
    SETTINGS.expiresAt,
    String(Date.now() + refreshed.body.expires_in * 1000)
  );

  return api;
}

function createConfiguredApi(): SpotifyWebApi {
  const config = getSpotifyConfig();
  if (!config.clientId || !config.clientSecret) {
    throw new Error("Add your Spotify Client ID and Client Secret first.");
  }

  return new SpotifyWebApi({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    redirectUri: REDIRECT_URI
  });
}

interface SpotifyPlaylistItemsResponse {
  items: Array<{
    added_at?: string;
    item?: SpotifyApi.TrackObjectFull | null;
    track?: SpotifyApi.TrackObjectFull | null;
  }>;
  next: string | null;
}

async function spotifyGet<T>(
  api: SpotifyWebApi,
  endpoint: string,
  params: Record<string, string | number>
): Promise<T> {
  const accessToken = api.getAccessToken();
  if (!accessToken) {
    throw new Error("Spotify access token is unavailable.");
  }

  const url = new URL(endpoint, "https://api.spotify.com");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    throw new Error(
      `Spotify API request failed: ${response.status} ${response.statusText}`
    );
  }

  return response.json() as Promise<T>;
}

function waitForAuthorizationCode(
  authUrl: string,
  state: string,
  parentWindow?: BrowserWindow
): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const server = https.createServer(SPOTIFY_OAUTH_TLS_CREDENTIALS, (request, response) => {
      if (!request.url) {
        return;
      }

      const callbackUrl = new URL(request.url, REDIRECT_URI);
      if (callbackUrl.pathname !== "/callback") {
        response.writeHead(404);
        response.end();
        return;
      }

      const error = callbackUrl.searchParams.get("error");
      const receivedState = callbackUrl.searchParams.get("state");
      const code = callbackUrl.searchParams.get("code");

      if (error) {
        response.end("Spotify login failed. You can close this window.");
        rejectOnce(new Error(error));
        return;
      }

      if (receivedState !== state || !code) {
        response.end("Spotify login failed. You can close this window.");
        rejectOnce(new Error("Spotify OAuth state mismatch."));
        return;
      }

      response.end("Spotify login complete. You can close this window.");
      resolveOnce(code);
    });

    let authWindow: BrowserWindow | undefined;

    const cleanup = () => {
      try {
        server.close();
      } catch {
        // The server may already be closed after an OAuth error path.
      }
      if (authWindow && !authWindow.isDestroyed()) {
        setTimeout(() => authWindow?.close(), 300);
      }
    };

    const resolveOnce = (code: string) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      resolve(code);
    };

    const rejectOnce = (error: Error) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      reject(error);
    };

    server.on("error", (error) => {
      rejectOnce(error);
    });

    server.listen(SPOTIFY_OAUTH_CALLBACK_PORT, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      if (address.port !== SPOTIFY_OAUTH_CALLBACK_PORT) {
        rejectOnce(new Error("Spotify OAuth callback port did not bind correctly."));
        return;
      }

      authWindow = new BrowserWindow({
        width: 520,
        height: 720,
        title: "Log in with Spotify",
        parent: parentWindow,
        modal: Boolean(parentWindow),
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true
        }
      });

      authWindow.webContents.session.setCertificateVerifyProc((request, callback) => {
        if (request.hostname === "127.0.0.1") {
          callback(0);
          return;
        }

        callback(-3);
      });

      authWindow.on("closed", () => {
        authWindow = undefined;
        rejectOnce(new Error("Spotify login window was closed."));
      });
      authWindow.loadURL(authUrl);
    });
  });
}

function clearSpotifyTokens(): void {
  deleteSettings([
    SETTINGS.accessToken,
    SETTINGS.refreshToken,
    SETTINGS.expiresAt,
    SETTINGS.userId,
    SETTINGS.displayName
  ]);
}

function sanitizeFileBaseName(fileName: string): string {
  const sanitized = fileName
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .replace(/\s+/g, " ")
    .trim();

  return sanitized || "Spotify Track";
}

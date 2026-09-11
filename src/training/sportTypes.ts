import type { TrainingHubSportType } from "../../electron/types";

// Keep in sync with electron/corosSportTypes.ts for renderer-side fallbacks.
const KNOWN_SPORT_NAMES: Record<number, string> = {
  98: "Custom Sport",
  100: "Run",
  101: "Indoor Run",
  102: "Trail Run",
  103: "Track Run",
  104: "Hike",
  105: "Mountain Climb",
  106: "Climb",
  200: "Bike",
  201: "Indoor Bike",
  202: "Road E-Bike",
  203: "Gravel Road Bike",
  204: "Mountain Bike",
  205: "Mountain E-Bike",
  299: "Helmet Bike",
  300: "Pool Swim",
  301: "Open Water Swim",
  400: "Gym Cardio",
  401: "GPS Cardio",
  402: "Strength",
  500: "Ski",
  501: "Snowboard",
  502: "XC Ski",
  503: "Ski Touring",
  600: "Fighter",
  700: "Rowing",
  701: "Indoor Rowing",
  702: "Whitewater",
  704: "Flatwater",
  705: "Windsurfing",
  706: "Speedsurfing",
  707: "Boat Fishing Lure",
  708: "Shore Fishing Lure",
  709: "Pond Fishing Lure",
  710: "Kayak Fishing Lure",
  711: "Inshore Fishing",
  712: "Offshore Fishing",
  713: "Boat Fly Fishing",
  714: "Shore Fly Fishing",
  715: "Surf Fishing",
  800: "Indoor Climb",
  801: "Bouldering",
  802: "Outdoor Climb",
  900: "Walk",
  901: "Jump Rope",
  902: "Climb Stairs",
  903: "Elliptical",
  904: "Yoga",
  905: "Pilates",
  906: "Boxing",
  1000: "Badminton",
  1001: "Ping Pong",
  1002: "Basketball",
  1003: "Soccer",
  1004: "Pickleball",
  1005: "Tennis",
  1006: "Padel",
  1100: "Frisbee",
  1101: "Skateboard",
  1200: "Hybrid Fitness",
  9800: "Custom Outdoor Ball",
  9801: "Custom Outdoor Leisure",
  9802: "Custom Outdoor Mountain",
  9803: "Custom Outdoor High Altitude",
  9804: "Custom Outdoor Motor Vehicle",
  9805: "Custom Outdoor Aquatics",
  9806: "Custom Outdoor Adventure",
  9807: "Custom Outdoor Other",
  9900: "Custom Indoor Ball",
  9901: "Custom Indoor Strength",
  9902: "Custom Indoor Shape",
  9903: "Custom Indoor Dance",
  9904: "Custom Indoor Other",
  9999: "Custom Activity",
  10000: "Triathlon",
  10001: "Multi Sport",
  10002: "Ski Touring",
  10003: "Multi-Pitch Climb",
  65535: "All Sports"
};

export function isSwimSportType(sportType?: number): boolean {
  return sportType === 300 || sportType === 301;
}

export function isCyclingSportType(sportType?: number): boolean {
  return sportType !== undefined && sportType >= 200 && sportType <= 299;
}

export function resolveSportName(
  activity: {
    sportType?: number;
    sportName?: string;
  },
  sportTypes: TrainingHubSportType[] | Map<number, string> = []
): string | undefined {
  if (activity.sportName?.trim()) {
    return activity.sportName.trim();
  }

  const sportType = activity.sportType;
  if (sportType === undefined) {
    return undefined;
  }

  const lookup =
    sportTypes instanceof Map
      ? sportTypes
      : new Map(sportTypes.map((item) => [item.sportType, item.sportName]));

  const fromMap = lookup.get(sportType)?.trim();
  if (fromMap) {
    return fromMap;
  }

  return KNOWN_SPORT_NAMES[sportType];
}

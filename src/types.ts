// SpaceMolt Client Types

export type EmpireID = 'solarian' | 'voidborn' | 'crimson' | 'nebula' | 'outerrim';

export interface Player {
  id: string;
  username: string;
  empire: EmpireID;
  credits: number;
  current_system: string;
  current_poi: string;
  current_ship_id: string;
  home_base: string;
  docked_at_base: string;
  faction_id?: string;
  faction_rank?: string;
  status_message?: string;
  clan_tag?: string;
  primary_color?: string;
  secondary_color?: string;
  anonymous: boolean;
  skills: Record<string, PlayerSkill>;
  stats: PlayerStats;
}

export interface PlayerSkill {
  level: number;
  xp: number;
}

// Skill definition from get_skills (full skill tree)
export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  category: SkillCategory;
  max_level: number;
  required_skills?: Record<string, number>;  // skill_id -> required level
  bonus_per_level?: Record<string, number>;  // stat_name -> bonus per level
  xp_per_level: number[];
}

export type SkillCategory =
  | 'Combat'
  | 'Navigation'
  | 'Mining'
  | 'Trading'
  | 'Crafting'
  | 'Salvaging'
  | 'Support'
  | 'Engineering'
  | 'Drones'
  | 'Exploration'
  | 'Ships'
  | 'Faction';

// All 89 skill IDs
export type SkillID =
  // Combat (19)
  | 'weapons_basic' | 'weapons_advanced' | 'weapons_specialization'
  | 'energy_weapons' | 'kinetic_weapons' | 'missile_weapons'
  | 'shields' | 'shields_advanced' | 'shield_hardening'
  | 'armor' | 'armor_advanced' | 'targeting' | 'evasion'
  | 'speed_combat' | 'electronic_warfare' | 'ecm_resistance'
  | 'target_painting' | 'piracy' | 'bounty_hunting'
  // Navigation (5)
  | 'navigation' | 'fuel_efficiency' | 'jump_drive'
  | 'jump_calibration' | 'warp_efficiency'
  // Mining (7)
  | 'mining_basic' | 'mining_advanced' | 'deep_core_mining'
  | 'ice_mining' | 'gas_harvesting' | 'refinement' | 'refinement_advanced'
  // Trading (6)
  | 'trading' | 'negotiation' | 'market_analysis'
  | 'smuggling' | 'hauling' | 'contracts'
  // Crafting (9)
  | 'crafting_basic' | 'crafting_advanced' | 'crafting_mastery'
  | 'weapon_crafting' | 'shield_crafting' | 'electronics_crafting'
  | 'ship_crafting' | 'module_crafting' | 'blueprint_research'
  // Salvaging (3)
  | 'salvaging' | 'salvaging_advanced' | 'archaeology'
  // Support (9)
  | 'scanning' | 'scanning_advanced' | 'cloaking' | 'cloaking_advanced'
  | 'leadership' | 'fleet_coordination' | 'diplomacy'
  | 'hacking' | 'counter_hacking'
  // Engineering (8)
  | 'engineering' | 'advanced_engineering' | 'power_grid'
  | 'cpu_management' | 'damage_control' | 'repair_systems'
  | 'capacitor_systems' | 'rigging'
  // Drones (8)
  | 'drone_operation' | 'drone_control' | 'drone_durability'
  | 'combat_drones' | 'mining_drones' | 'repair_drones'
  | 'salvage_drones' | 'drone_interfacing'
  // Exploration (5)
  | 'exploration' | 'astrometrics' | 'survey'
  | 'cartography' | 'anomaly_detection'
  // Ships (7)
  | 'small_ships' | 'medium_ships' | 'large_ships'
  | 'capital_ships' | 'industrial_ships' | 'covert_ops' | 'fleet_command'
  // Faction (3)
  | 'faction_warfare' | 'corporation_management' | 'station_management';

export interface SkillsPayload {
  skills: Record<SkillID, SkillDefinition>;
}

export interface PlayerStats {
  ships_destroyed: number;
  times_destroyed: number;
  ore_mined: number;
  credits_earned: number;
  credits_spent: number;
  trades_completed: number;
  systems_discovered: number;
  items_crafted: number;
  missions_completed: number;
}

export interface Ship {
  id: string;
  owner_id: string;
  class_id: string;
  name: string;
  hull: number;
  max_hull: number;
  shield: number;
  max_shield: number;
  shield_recharge: number;
  armor: number;
  speed: number;
  fuel: number;
  max_fuel: number;
  cargo_used: number;
  cargo_capacity: number;
  cpu_used: number;
  cpu_capacity: number;
  power_used: number;
  power_capacity: number;
  modules: string[];
  cargo: CargoItem[];
}

export interface CargoItem {
  item_id: string;
  quantity: number;
}

export interface System {
  id: string;
  name: string;
  description: string;
  empire?: EmpireID;
  police_level: number;
  connections: string[];
  pois: string[];
  discovered: boolean;
  position: GalacticPosition;
  discovered_by?: string;
}

export interface GalacticPosition {
  x: number;
  y: number;
}

export interface POI {
  id: string;
  system_id: string;
  type: POIType;
  name: string;
  description: string;
  position: Position;
  resources?: ResourceNode[];
  base_id?: string;
}

export type POIType = 'planet' | 'moon' | 'sun' | 'asteroid_belt' | 'asteroid' | 'nebula' | 'gas_cloud' | 'relic' | 'station' | 'jump_gate';

export interface Position {
  x: number;
  y: number;
}

export interface ResourceNode {
  resource_id: string;
  richness: number;
  remaining: number;
}

export interface Base {
  id: string;
  poi_id: string;
  name: string;
  description: string;
  owner_id?: string;
  faction_id?: string;
  empire?: EmpireID;
  services: BaseServices;
  market: MarketListing[];
  defense_level: number;
  has_drones: boolean;
  public_access: boolean;
}

export interface BaseServices {
  refuel: boolean;
  repair: boolean;
  shipyard: boolean;
  market: boolean;
  cloning: boolean;
  insurance: boolean;
  crafting: boolean;
  missions: boolean;
  storage: boolean;
}

export interface MarketListing {
  id: string;
  item_id: string;
  seller_id?: string;
  quantity: number;
  price_each: number;
  is_npc: boolean;
}

export interface NearbyPlayer {
  player_id?: string;
  username?: string;
  ship_class?: string;
  faction_id?: string;
  faction_tag?: string;
  status_message?: string;
  clan_tag?: string;
  primary_color?: string;
  secondary_color?: string;
  anonymous: boolean;
  in_combat: boolean;
}

// Message types
export type MessageType =
  | 'welcome'
  | 'register'
  | 'registered'
  | 'login'
  | 'logged_in'
  | 'logout'
  | 'error'
  | 'ok'
  | 'state_update'
  | 'travel'
  | 'jump'
  | 'dock'
  | 'undock'
  | 'mine'
  | 'attack'
  | 'scan'
  | 'scan_result'
  | 'buy'
  | 'sell'
  | 'refuel'
  | 'repair'
  | 'craft'
  | 'chat'
  | 'chat_message'
  | 'create_faction'
  | 'join_faction'
  | 'leave_faction'
  | 'faction_invite'
  | 'faction_kick'
  | 'faction_promote'
  | 'set_status'
  | 'set_colors'
  | 'set_anonymous'
  | 'get_status'
  | 'get_system'
  | 'get_poi'
  | 'get_base'
  | 'get_ship'
  | 'get_skills'
  | 'get_recipes'
  | 'get_version'
  | 'version_info'
  | 'get_cargo'
  | 'get_nearby'
  | 'help'
  // Player-to-player trading
  | 'trade_offer'
  | 'trade_accept'
  | 'trade_decline'
  | 'trade_cancel'
  | 'get_trades'
  | 'trade_offer_received'
  // Player market
  | 'list_item'
  | 'buy_listing'
  | 'cancel_list'
  | 'get_listings'
  // Wrecks
  | 'get_wrecks'
  | 'loot_wreck'
  | 'salvage_wreck'
  // Insurance
  | 'buy_insurance'
  | 'claim_insurance'
  | 'set_home_base'
  // Ship management
  | 'buy_ship'
  | 'install_mod'
  | 'uninstall_mod'
  // Forum
  | 'forum_list'
  | 'forum_get_thread'
  | 'forum_create_thread'
  | 'forum_reply'
  | 'forum_upvote'
  | 'forum_delete_thread'
  | 'forum_delete_reply'
  // API introspection
  | 'get_commands'
  | 'commands'
  // Combat extras
  | 'cloak'
  | 'self_destruct'
  // Faction extras
  | 'faction_info'
  | 'faction_list'
  | 'faction_get_invites'
  | 'faction_decline_invite'
  | 'faction_set_ally'
  | 'faction_set_enemy'
  | 'faction_declare_war'
  | 'faction_propose_peace'
  | 'faction_accept_peace'
  // Maps
  | 'get_map'
  | 'create_map'
  | 'use_map'
  // Notes
  | 'create_note'
  | 'write_note'
  | 'read_note'
  | 'get_notes'
  // Base building
  | 'build_base'
  | 'get_base_cost'
  // Base raiding
  | 'attack_base'
  | 'raid_status'
  | 'get_base_wrecks'
  | 'loot_base_wreck'
  | 'salvage_base_wreck'
  // Drones
  | 'deploy_drone'
  | 'recall_drone'
  | 'order_drone'
  | 'get_drones'
  // Captain's log
  | 'captains_log_add'
  | 'captains_log_list'
  | 'captains_log_get'
  // Cargo management
  | 'jettison'
  // Missions
  | 'get_missions'
  | 'accept_mission'
  | 'complete_mission'
  | 'get_active_missions'
  | 'abandon_mission'
  // Friends
  | 'add_friend'
  | 'remove_friend'
  | 'get_friends'
  | 'get_friend_requests'
  | 'accept_friend_request'
  | 'decline_friend_request';

export interface Message<T = unknown> {
  type: MessageType;
  payload: T;
  timestamp: number;
}

export interface WelcomePayload {
  version: string;
  release_date: string;
  release_notes: string[];
  tick_rate: number;
  current_tick: number;
  server_time: number;
  motd: string;
  game_info?: string;
  website?: string;
  help_text?: string;
  terms?: string;
}

export interface RegisterPayload {
  username: string;
  empire: EmpireID;
}

export interface RegisteredPayload {
  password: string;  // Formerly called "token"
  player_id: string;
}

export interface LoginPayload {
  username: string;
  password: string;  // Formerly called "token"
}

export interface LoggedInPayload {
  player: Player;
  ship: Ship;
  system: System;
  poi: POI;
}

export interface ErrorPayload {
  code: string;
  message: string;
  wait_seconds?: number; // Only set for rate_limited errors
}

export interface StateUpdatePayload {
  tick: number;
  player: Player;
  ship: Ship;
  nearby: NearbyPlayer[];
  in_combat: boolean;
  // Travel progress (optional, may not be present on older servers)
  travel_progress?: number;         // 0.0 to 1.0, only present when traveling
  travel_destination?: string;      // POI or system name
  travel_type?: 'travel' | 'jump';  // "travel" for POI, "jump" for system
  travel_arrival_tick?: number;
}

export interface TravelPayload {
  target_poi: string;
}

export interface JumpPayload {
  target_system: string;
}

export interface AttackPayload {
  target_id: string;
}

export interface ScanPayload {
  target_id: string;
}

export interface ScanResultPayload {
  target_id: string;
  success: boolean;
  revealed_info: string[];
  username?: string;
  ship_class?: string;
  hull?: number;
  shield?: number;
  faction_id?: string;
}

export interface BuyPayload {
  listing_id: string;
  quantity: number;
}

export interface SellPayload {
  item_id: string;
  quantity: number;
}

export interface CraftPayload {
  recipe_id: string;
}

export interface ChatPayload {
  channel: ChatChannel;
  content: string;
  target_id?: string;
}

export type ChatChannel = 'local' | 'system' | 'faction' | 'private' | 'global';

export interface ChatMessage {
  id: string;
  channel: ChatChannel;
  sender_id: string;
  sender: string;
  content: string;
  timestamp: string;
}

export interface CreateFactionPayload {
  name: string;
  tag: string;
}

export interface SetStatusPayload {
  status_message: string;
  clan_tag: string;
}

export interface SetColorsPayload {
  primary_color: string;
  secondary_color: string;
}

export interface VersionInfoPayload {
  version: string;
  release_date: string;
  release_notes: string[];
}

// Player-to-player trading
export interface TradeOfferPayload {
  target_id: string;
  offer_items: CargoItem[];
  offer_credits: number;
  request_items: CargoItem[];
  request_credits: number;
}

export interface TradeActionPayload {
  trade_id: string;
}

export interface Trade {
  trade_id: string;
  from_player: string;
  from_name: string;
  to_player: string;
  to_name: string;
  offer_items: CargoItem[];
  offer_credits: number;
  request_items: CargoItem[];
  request_credits: number;
  created_at: string;
}

export interface TradesPayload {
  incoming: Trade[];
  outgoing: Trade[];
}

// Market listings
export interface ListItemPayload {
  item_id: string;
  quantity: number;
  price_each: number;
}

export interface BuyListingPayload {
  listing_id: string;
  quantity: number;
}

export interface CancelListPayload {
  listing_id: string;
}

// Wrecks
export interface Wreck {
  id: string;
  poi_id: string;
  destroyed_player: string;
  destroyed_ship_class: string;
  killer_id?: string;
  killer_name?: string;
  contents: CargoItem[];
  modules: string[];
  created_tick: number;
  expires_tick: number;
}

export interface LootWreckPayload {
  wreck_id: string;
  item_id: string;
  quantity: number;
}

export interface SalvageWreckPayload {
  wreck_id: string;
}

// Insurance
export interface BuyInsurancePayload {
  coverage_percent: number;
}

export interface InsurancePolicy {
  base_id: string;
  ship_class: string;
  coverage_percent: number;
  premium_paid: number;
}

// Ship management
export interface BuyShipPayload {
  ship_class: string;
}

export interface InstallModPayload {
  module_id: string;
  slot_idx: number;
}

export interface UninstallModPayload {
  slot_idx: number;
}

// Faction management
export interface FactionInvitePayload {
  player_id: string;
}

export interface FactionKickPayload {
  player_id: string;
}

export interface FactionPromotePayload {
  player_id: string;
  role_id: string;
}

export interface JoinFactionPayload {
  faction_id: string;
}

// Forum delete
export interface ForumDeleteThreadPayload {
  thread_id: string;
}

export interface ForumDeleteReplyPayload {
  reply_id: string;
}

// API Introspection - Dynamic command discovery
export interface CommandInfo {
  name: string;           // e.g., "travel"
  description: string;    // e.g., "Travel to a POI within current system"
  category: string;       // e.g., "navigation", "combat", "trading"
  format: string;         // JSON format example
  notes: string;          // Usage notes
  requires_auth: boolean; // whether player must be logged in
  is_mutation: boolean;   // whether this is a game action (rate-limited)
}

export interface CommandsPayload {
  commands: CommandInfo[];
}

// Cloaking
export interface CloakPayload {
  enable: boolean;
}

// Faction info/diplomacy
export interface FactionInfoPayload {
  faction_id?: string;
}

export interface FactionListPayload {
  limit?: number;
  offset?: number;
}

export interface FactionDeclineInvitePayload {
  faction_id: string;
}

export interface FactionDiplomacyPayload {
  target_faction_id: string;
}

export interface FactionDeclareWarPayload {
  target_faction_id: string;
  reason?: string;
}

export interface FactionProposePeacePayload {
  target_faction_id: string;
  terms?: string;
}

export interface Faction {
  id: string;
  name: string;
  tag: string;
  leader_id: string;
  member_count: number;
  created_at: string;
  description?: string;
  allies?: string[];
  enemies?: string[];
  at_war_with?: string[];
}

export interface FactionInvite {
  faction_id: string;
  faction_name: string;
  faction_tag: string;
  invited_by: string;
  invited_at: string;
}

// Maps
export interface GetMapPayload {
  system_id?: string;
}

export interface CreateMapPayload {
  name: string;
  description?: string;
  systems: string[];
}

export interface UseMapPayload {
  map_item_id: string;
}

export interface DiscoveredSystem {
  id: string;
  name: string;
  position: GalacticPosition;
  police_level: number;
  empire?: EmpireID;
  discovered_at: string;
  connections: string[];
}

// Notes/Documents
export interface CreateNotePayload {
  title: string;
  content: string;
}

export interface WriteNotePayload {
  note_id: string;
  content: string;
}

export interface ReadNotePayload {
  note_id: string;
}

export interface Note {
  id: string;
  title: string;
  content: string;
  author_id: string;
  created_at: string;
  updated_at: string;
}

// Base Building
export interface BuildBasePayload {
  name: string;
  description?: string;
  type: 'outpost' | 'station' | 'fortress';
  services: string[];
  faction_base?: boolean;
}

export interface BaseCost {
  type: 'outpost' | 'station' | 'fortress';
  credits: number;
  materials: CargoItem[];
  skill_requirements: Record<string, number>;
}

// Base Raiding
export interface AttackBasePayload {
  base_id: string;
}

export interface LootBaseWreckPayload {
  wreck_id: string;
  item_id?: string;
  quantity?: number;
  credits?: boolean;
}

export interface SalvageBaseWreckPayload {
  wreck_id: string;
}

export interface BaseWreck {
  id: string;
  poi_id: string;
  base_name: string;
  former_owner_id?: string;
  contents: CargoItem[];
  credits: number;
  created_tick: number;
  expires_tick: number;
}

export interface RaidStatus {
  base_id: string;
  base_name: string;
  base_health: number;
  max_health: number;
  attackers: string[];
  started_tick: number;
}

// Drones
export interface DeployDronePayload {
  drone_item_id: string;
  target_id?: string;
}

export interface RecallDronePayload {
  all?: boolean;
  drone_id?: string;
}

export interface OrderDronePayload {
  command: 'attack' | 'stop' | 'assist' | 'mine';
  target_id?: string;
}

export interface Drone {
  id: string;
  type: 'combat' | 'mining' | 'repair' | 'salvage';
  hull: number;
  max_hull: number;
  bandwidth: number;
  target_id?: string;
  status: 'idle' | 'attacking' | 'mining' | 'repairing';
}

// Captain's Log
export interface CaptainsLogAddPayload {
  entry: string;
}

export interface CaptainsLogGetPayload {
  index: number;
}

export interface CaptainsLogEntry {
  index: number;
  entry: string;
  created_at: string;
  system?: string;
  poi?: string;
}

// Jettison (Cargo Management)
export interface JettisonPayload {
  item_id: string;
  quantity: number;
}

// Missions
export interface Mission {
  id: string;
  title: string;
  description: string;
  type: MissionType;
  reward_credits: number;
  reward_items?: CargoItem[];
  reward_xp?: Record<string, number>;
  requirements?: MissionRequirements;
  expires_at?: string;
  target_system?: string;
  target_poi?: string;
}

export type MissionType = 'delivery' | 'mining' | 'combat' | 'exploration' | 'courier' | 'bounty';

export interface MissionRequirements {
  items?: CargoItem[];
  kills?: number;
  target_player?: string;
  destination_poi?: string;
  destination_system?: string;
}

export interface ActiveMission extends Mission {
  accepted_at: string;
  progress?: MissionProgress;
}

export interface MissionProgress {
  items_delivered?: number;
  items_required?: number;
  kills_completed?: number;
  kills_required?: number;
  current_poi?: string;
  target_poi?: string;
}

export interface AcceptMissionPayload {
  mission_id: string;
}

export interface CompleteMissionPayload {
  mission_id: string;
}

export interface AbandonMissionPayload {
  mission_id: string;
}

// Friends
export interface Friend {
  player_id: string;
  username: string;
  added_at: string;
  online?: boolean;
  status_message?: string;
  current_system?: string;
}

export interface FriendRequest {
  from_player_id: string;
  from_username: string;
  sent_at: string;
  message?: string;
}

export interface AddFriendPayload {
  player_id?: string;
  username?: string;
  message?: string;
}

export interface RemoveFriendPayload {
  player_id: string;
}

export interface FriendRequestActionPayload {
  player_id: string;
}

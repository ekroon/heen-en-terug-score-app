import {get, writable} from 'svelte/store';
import {Base64} from 'js-base64';
import {migrateDealerId, migrateTrumps} from "./migrations.js";
import {
    calculateScoresForGame,
    currentRoundForGame,
    initialGame,
    initialRound,
    GAME_VERSION,
    deserializeGame, serializeGame
} from "./lib.js";

const localStorageKey = 'heen-en-weer-store';

const initialPlayer = {
    id: 0,
    name: 'empty',
    score: 0,
    highestRoundScore: 0,
    nCorrectBids: 0,
    highestRoundTricks: 0,
    leaderBoardPosition: 0,
    previousLeaderBoardPosition: undefined,
}

// Initial store state
const initialStore = {
    games: [],
};

// Create a writable store with initial store state
const gameStore = writable(initialStore);

const storedStore = localStorage.getItem(localStorageKey);
if (storedStore) {
    try {
        gameStore.set(JSON.parse(storedStore));
    } catch (e) {
        gameStore.set(initialStore);
    }
}

gameStore.subscribe(store => {
    localStorage.setItem(localStorageKey, JSON.stringify(store));
});

// Add a new game to the store
export function addGame(id, name) {
    gameStore.update(store => {
        const game = initialGame(id, name);
        store.games = [...store.games, game];
        return store;
    });
}

export function deleteGame(id) {
    gameStore.update(store => {
        store.games = store.games.filter(game => game.id !== id);
        return store;
    });
}

export function listGames() {
    const store = get(gameStore);
    return store.games;
}

export function gameExists(gameId) {
    const store = get(gameStore);
    return store.games.some(game => game.id === gameId);
}

export function getGame(gameId) {
    const store = get(gameStore);
    let game = _getGameFromId(store, gameId)
    if (game.gameVersion === undefined || game.gameVersion < GAME_VERSION) {
        calculateScoresForGame(game);
        if (game.gameVersion < 2) {
            migrateTrumps(game);
        }
        if (game.gameVersion < 3) {
            migrateDealerId(game)
        }
        game.gameVersion = GAME_VERSION;
        saveGame(gameId, game);
    }
    //clone the game object to prevent mutation
    return JSON.parse(JSON.stringify(game));
}

export function saveGame(id, game) {
    gameStore.update(store => {
        const index = store.games.findIndex(game => game.id === id);
        store.games[index] = game;
        return store;
    });
}

export async function shareGame(gameId) {
    let game = getGame(gameId);
    let serialized = await serializeGame(game);
    return Base64.fromUint8Array(serialized, true);
}

export function importGame(game) {
    let id = game.id;
    let counter = 1;
    while (gameExists(id)) {
        id = `${game.id}+${counter}`;
    }
    game.id = id;
    gameStore.update(store => {
        store.games = [...store.games, game];
        return store;
    });

    return game.id;
}

export async function loadGame(encodedGame) {
    let serialized = Base64.toUint8Array(encodedGame);
    return await deserializeGame(serialized);
}

// Add a player to a specific game
export function addPlayer(gameId, name) {
    gameStore.update(store => {
        const gameIndex = store.games.findIndex(game => game.id === gameId);
        if (gameIndex !== -1) {
            const playerCount = store.games[gameIndex].players.length;
            let player = Object.assign({}, initialPlayer);
            player.id = playerCount;
            player.name = name;
            store.games[gameIndex].players = [...store.games[gameIndex].players, player];
        }
        return store;
    });
}

// List all players for a specific game
export function listPlayers(gameId) {
    const store = get(gameStore);
    const game = store.games.find(game => game.id === gameId);
    if (game) {
        return game.players;
    }
    return [];
}

// Add a round to a specific game
export function addRound(id, nCards, trump, dealerId) {
    gameStore.update(store => {
        let gameIndex = store.games.findIndex(game => game.id === id);
        let round = Object.assign({}, initialRound);
        round.nCards = nCards;
        round.trump = trump;
        round.dealerId = dealerId;
        store.games[gameIndex].rounds = [...store.games[gameIndex].rounds, round];
        return store;
    });
}

export function updatePlayerBids(gameId, roundId, bids) {
    gameStore.update(store => {
        let game = _getGameFromId(store, gameId);
        game.rounds[roundId].bids = bids;
        return store;
    });
}

export function updatePlayerTricks(gameId, roundId, tricks) {
    gameStore.update(store => {
        let game = _getGameFromId(store, gameId);
        game.rounds[roundId].tricks = tricks;
        return store;
    });
}

export function calculateScores(id) {
    gameStore.update(store => {
        let game = _getGameFromId(store, id);

        calculateScoresForGame(game);

        return store;
    });
}

export function getStandings(gameId) {
    let game = getGame(gameId);
    return getStandingsForGame(game);
}

export function getStandingsForGame(game) {
    let standings = [...game.players];
    standings.sort((a, b) => a.leaderBoardPosition - b.leaderBoardPosition);
    return standings.map(player => {
        let standingsDiff = undefined
        if (player.previousLeaderBoardPosition !== undefined) {
            standingsDiff = player.previousLeaderBoardPosition - player.leaderBoardPosition;
        }
        return {
            name: player.name,
            score: player.score,
            options: standingsDiff !== undefined ? {standingsDiff} : {},
        }
    });
}

function _getGameFromId(store, id) {
    return store.games.find(game => game.id === id);
}

export function currentRoundId(gameId) {
    let game = getGame(gameId);
    return currentRoundForGame(game);
}

export function getTotals() {
    const store = get(gameStore);
    let totals = store.games.reduce((acc, game) => {
        game.players.forEach(player => {
            if (!acc[player.name]) {
                acc[player.name] = { name: player.name, score: 0, games: 0 };
            }
            acc[player.name].score += player.score;
            acc[player.name].games += 1;
        });
        return acc;
    }, {})
    return Object.values(totals);
}

export function allPlayerNames() {
    const store = get(gameStore);
    let names = new Set();
    store.games.forEach(game => {
        game.players.forEach(player => {
            names.add(player.name);
        });
    });
    return Array.from(names).sort();
}

export function playersForLastGame() {
    const store = get(gameStore);
    let game = store.games[store.games.length - 1];
    return Array.from(game.players.map(player => player.name));
}

// Reset the store state
export function resetStore() {
    gameStore.set(initialStore);
}

export default gameStore;

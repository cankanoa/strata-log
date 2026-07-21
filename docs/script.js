const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const spiral = document.querySelector("#fieldSpiral");
const cursor = spiral?.querySelector(".edit-cursor");
const headerOptions = ["Project", "Client", "Task", "Status", "Billable", "Tags", "Started", "Ended", "Duration", "File", "Notes", "Category", "Priority", "Energy", "Location", "Milestone", "Repository", "Sprint", "Department", "Outcome", "Team", "Phase", "Workspace", "Estimate", "Context", "Goal", "Owner", "Source", "Type", "Review", "Deadline", "Progress", "Account", "Activity", "Assignee", "Budget", "Campaign", "Channel", "Company", "Cost", "Created", "Device", "Due Date", "Effort", "Environment", "Folder", "Frequency", "Label", "Language", "Link", "Mood", "Objective", "Path", "Rate", "Region", "Role", "Schedule", "Stage", "Topic", "Updated"];

function shuffled(values) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

const shuffledHeaders = shuffled(headerOptions);
const initialHeaders = shuffledHeaders.slice(0, 30);
let replacementHeaders = shuffled(shuffledHeaders.slice(30));
const movingHeaders = [];
const spiralMotion = {
  baseSpeed: .018,
  innerBoost: 2.4,
  boostStart: .55,
  deleteDelay: 58,
  minimumDeleteDelay: 22,
  typeDelay: 42
};
let replacementIndex = 0;
let editing = false;
let cursorHeader = null;
let previousFrame = performance.now();

function spiralPoint(progress) {
  const angle = progress * Math.PI * 10.6 - Math.PI * .15;
  const radius = 260 * Math.pow(1 - progress, .82) + 3;
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius
  };
}

function headerSpeed(progress) {
  const innerProgress = Math.max(0, (progress - spiralMotion.boostStart) / (1 - spiralMotion.boostStart));
  return spiralMotion.baseSpeed * (1 + spiralMotion.innerBoost * innerProgress * innerProgress);
}

function deletionDelay(progress) {
  return Math.max(spiralMotion.minimumDeleteDelay, spiralMotion.deleteDelay * (1 - progress * .72));
}

function spiralRotation(progress) {
  const current = spiralPoint(progress);
  const next = spiralPoint(Math.min(.999, progress + .003));
  return Math.atan2(next.y - current.y, next.x - current.x) * 180 / Math.PI;
}

function createHeader(text, progress) {
  const element = document.createElement("span");
  element.className = "field-word";
  element.textContent = text;
  spiral?.append(element);
  return { element, progress, x: 0, y: 0, rotation: 0 };
}

function positionHeader(header) {
  const progress = Math.min(.995, Math.max(0, header.progress));
  const point = spiralPoint(progress);
  const rotation = spiralRotation(progress);
  header.x = point.x;
  header.y = point.y;
  header.rotation = rotation;
  header.element.style.setProperty("--x", `${point.x}px`);
  header.element.style.setProperty("--y", `${point.y}px`);
  header.element.style.setProperty("--rotation", `${rotation}deg`);
  header.element.style.setProperty("--scale", `${1 - progress * .18}`);
}

function positionCursor(header) {
  if (!cursor || !header) return;
  const radians = header.rotation * Math.PI / 180;
  const distance = Math.max(10, header.element.textContent.length * 3.8);
  cursor.style.setProperty("--cursor-x", `${header.x + Math.cos(radians) * distance}px`);
  cursor.style.setProperty("--cursor-y", `${header.y + Math.sin(radians) * distance}px`);
  cursor.style.setProperty("--cursor-rotation", `${header.rotation}deg`);
  cursor.classList.remove("hidden");
}

if (spiral) {
  let progress = .006;
  initialHeaders.forEach((name, index) => {
    const spacingNoise = .004 * Math.sin(index * 2.37) + .0025 * Math.sin(index * 5.13);
    progress += .024 + spacingNoise;
    movingHeaders.push(createHeader(name, progress));
  });
  movingHeaders.forEach(positionHeader);
}

const wait = (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

async function replaceLeadingHeader(header) {
  editing = true;
  cursorHeader = header;
  header.element.classList.add("editing");

  while (header.element.textContent.length > 0) {
    header.element.textContent = header.element.textContent.slice(0, -1);
    await wait(deletionDelay(header.progress));
  }

  const index = movingHeaders.indexOf(header);
  if (index >= 0) movingHeaders.splice(index, 1);
  header.element.remove();

  const nextText = replacementHeaders[replacementIndex % replacementHeaders.length];
  replacementIndex += 1;
  if (replacementIndex % replacementHeaders.length === 0) replacementHeaders = shuffled(replacementHeaders);
  const newHeader = createHeader("", .012);
  movingHeaders.unshift(newHeader);
  positionHeader(newHeader);
  cursorHeader = newHeader;
  newHeader.element.classList.add("editing");

  for (const letter of nextText) {
    newHeader.element.textContent += letter;
    await wait(spiralMotion.typeDelay);
  }

  newHeader.element.classList.remove("editing");
  cursorHeader = null;
  cursor?.classList.add("hidden");
  editing = false;
}

function animateSpiral(now) {
  const elapsedSeconds = Math.min(.05, (now - previousFrame) / 1000);
  previousFrame = now;
  movingHeaders.forEach((header) => {
    header.progress += elapsedSeconds * headerSpeed(header.progress);
    positionHeader(header);
  });
  if (cursorHeader) positionCursor(cursorHeader);

  if (!editing) {
    const leadingHeader = movingHeaders.reduce((leader, header) => !leader || header.progress > leader.progress ? header : leader, null);
    if (leadingHeader?.progress >= .78) void replaceLeadingHeader(leadingHeader);
  }
  requestAnimationFrame(animateSpiral);
}

if (!reduceMotion && spiral) requestAnimationFrame(animateSpiral);
else cursor?.classList.add("hidden");

const countdown = document.querySelector("#focusCountdown");
let remaining = 25 * 60;
if (countdown && !reduceMotion) {
  window.setInterval(() => {
    remaining = remaining > 0 ? remaining - 1 : 25 * 60;
    const minutes = String(Math.floor(remaining / 60)).padStart(2, "0");
    const seconds = String(remaining % 60).padStart(2, "0");
    countdown.textContent = `${minutes}:${seconds}`;
  }, 1000);
}

const pacmanTrack = document.querySelector(".pacman-track");
const pacman = pacmanTrack?.querySelector(".pacman");
const pacmanDots = [];
const dotCount = 48;
const refillDistance = Math.ceil(dotCount * 2 / 3);

function rectanglePoint(progress) {
  const width = pacmanTrack?.clientWidth || 320;
  const height = pacmanTrack?.clientHeight || 190;
  const perimeter = 2 * (width + height);
  let distance = ((progress % 1) + 1) % 1 * perimeter;
  if (distance < width) return { x: distance / width * 100, y: 0, direction: 0 };
  distance -= width;
  if (distance < height) return { x: 100, y: distance / height * 100, direction: 90 };
  distance -= height;
  if (distance < width) return { x: (1 - distance / width) * 100, y: 100, direction: 180 };
  distance -= width;
  return { x: 0, y: (1 - distance / height) * 100, direction: 270 };
}

function positionPacmanDots() {
  pacmanDots.forEach((dot, index) => {
    const point = rectanglePoint(index / dotCount);
    dot.style.left = `${point.x}%`;
    dot.style.top = `${point.y}%`;
  });
}

if (pacmanTrack) {
  for (let index = 0; index < dotCount; index += 1) {
    const dot = document.createElement("i");
    dot.className = "pacman-dot";
    pacmanTrack.append(dot);
    pacmanDots.push(dot);
  }
  positionPacmanDots();
  window.addEventListener("resize", positionPacmanDots, { passive: true });
}

if (pacmanTrack && pacman && !reduceMotion) {
  let lastDotIndex = -1;
  const cycleSeconds = 18;

  function animatePacman(now) {
    const progress = (now / 1000 / cycleSeconds) % 1;
    const point = rectanglePoint(progress);
    pacman.style.left = `${point.x}%`;
    pacman.style.top = `${point.y}%`;
    pacman.style.setProperty("--pacman-direction", `${point.direction}deg`);

    const dotIndex = Math.floor(progress * dotCount) % dotCount;
    if (dotIndex !== lastDotIndex) {
      pacmanDots[dotIndex]?.classList.add("eaten");
      if (lastDotIndex >= 0) {
        const refillIndex = (dotIndex - refillDistance + dotCount) % dotCount;
        pacmanDots[refillIndex]?.classList.remove("eaten");
      }
      lastDotIndex = dotIndex;
    }
    requestAnimationFrame(animatePacman);
  }

  requestAnimationFrame(animatePacman);
}

const dinoGame = document.querySelector("#dinoGame");
const gameCanvas = document.querySelector("#dinoGameCanvas");
const gamePrompt = document.querySelector("#dinoGamePrompt");
const gameScore = document.querySelector("#dinoGameScore");
const gameContext = gameCanvas?.getContext("2d");

if (dinoGame && gameCanvas && gamePrompt && gameScore && gameContext) {
  const runner = { x: 74, y: 0, width: 58, height: 44, velocity: 0, grounded: true };
  let gameWidth = 0;
  let gameHeight = 0;
  let groundY = 0;
  let gameState = "idle";
  let obstacles = [];
  let spawnTimer = 1.1;
  let score = 0;
  let lastGameFrame = performance.now();
  let restartReadyAt = 0;
  let gameCloudColor = "#0b2f4a";
  let gameGroundColor = "#071f31";
  let runnerCharacter = 0;

  function resizeGame() {
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    gameWidth = dinoGame.clientWidth;
    gameHeight = dinoGame.clientHeight;
    groundY = gameHeight - 34;
    gameCanvas.width = Math.round(gameWidth * ratio);
    gameCanvas.height = Math.round(gameHeight * ratio);
    gameContext.setTransform(ratio, 0, 0, ratio, 0, 0);
    const gameStyles = getComputedStyle(dinoGame);
    gameCloudColor = gameStyles.backgroundColor;
    gameGroundColor = gameStyles.getPropertyValue("--game-ground").trim() || "#071f31";
    if (runner.grounded) runner.y = groundY;
  }

  function resetGame() {
    obstacles = [];
    score = 0;
    spawnTimer = .9;
    runner.y = groundY;
    runner.velocity = 0;
    runner.grounded = true;
    runnerCharacter = Math.floor(Math.random() * 4);
    gameScore.value = "00000";
  }

  function jump() {
    if (!runner.grounded) return;
    runner.velocity = -610;
    runner.grounded = false;
  }

  function playOrJump() {
    if (gameState === "over" && performance.now() < restartReadyAt) return;
    if (gameState !== "running") {
      resetGame();
      gameState = "running";
      gamePrompt.classList.add("hidden");
    }
    jump();
  }

  function endGame() {
    gameState = "over";
    restartReadyAt = performance.now() + 900;
    gamePrompt.textContent = "Game over- Click space to start";
    gamePrompt.classList.remove("hidden");
  }

  function spawnObstacle() {
    const profiles = [
      { type: "rock", width: [25, 47], height: [18, 34] },
      { type: "fern", width: [22, 34], height: [32, 58] },
      { type: "cycad", width: [30, 45], height: [28, 48] },
      { type: "log", width: [44, 68], height: [14, 23] },
      { type: "stump", width: [25, 38], height: [25, 43] },
      { type: "stones", width: [43, 64], height: [20, 34] },
      { type: "spikes", width: [32, 52], height: [23, 39] }
    ];
    const profile = profiles[Math.floor(Math.random() * profiles.length)];
    const width = profile.width[0] + Math.random() * (profile.width[1] - profile.width[0]);
    const height = profile.height[0] + Math.random() * (profile.height[1] - profile.height[0]);
    obstacles.push({ x: gameWidth + 30, width, height, type: profile.type });
    spawnTimer = .82 + Math.random() * 1.15;
  }

  function drawRunner(time) {
    const x = runner.x;
    const top = runner.y - runner.height;
    const step = runner.grounded && gameState === "running" ? Math.sin(time * .018) * 4 : 0;
    gameContext.fillStyle = "#9bd8ff";

    if (runnerCharacter === 0) {
      gameContext.beginPath();
      gameContext.moveTo(x, top + 24);
      gameContext.lineTo(x - 26, top + 13);
      gameContext.lineTo(x + 11, top + 30);
      gameContext.fill();
      gameContext.fillRect(x + 4, top + 15, 31, 22);
      gameContext.fillRect(x + 27, top + 3, 27, 23);
      gameContext.fillRect(x + 47, top + 21, 14, 5);
      gameContext.fillRect(x + 11, top + 34, 7, 11 + step);
      gameContext.fillRect(x + 28, top + 34, 7, 11 - step);
      gameContext.fillRect(x + 28, top + 25, 15, 4);
    } else if (runnerCharacter === 1) {
      gameContext.beginPath();
      gameContext.ellipse(x + 18, top + 26, 28, 14, 0, 0, Math.PI * 2);
      gameContext.fill();
      gameContext.fillRect(x + 37, top + 20, 22, 16);
      gameContext.beginPath();
      gameContext.moveTo(x + 54, top + 21);
      gameContext.lineTo(x + 68, top + 15);
      gameContext.lineTo(x + 57, top + 27);
      gameContext.moveTo(x + 48, top + 20);
      gameContext.lineTo(x + 54, top + 8);
      gameContext.lineTo(x + 55, top + 22);
      gameContext.moveTo(x - 6, top + 26);
      gameContext.lineTo(x - 24, top + 20);
      gameContext.lineTo(x - 5, top + 32);
      gameContext.fill();
      gameContext.fillRect(x + 3, top + 34, 7, 10 + step);
      gameContext.fillRect(x + 34, top + 34, 7, 10 - step);
    } else if (runnerCharacter === 2) {
      gameContext.beginPath();
      gameContext.ellipse(x + 16, top + 29, 30, 12, 0, 0, Math.PI * 2);
      gameContext.fill();
      gameContext.beginPath();
      gameContext.moveTo(x - 8, top + 25);
      gameContext.lineTo(x - 28, top + 17);
      gameContext.lineTo(x - 4, top + 32);
      for (let plate = 0; plate < 5; plate += 1) {
        const plateX = x - 1 + plate * 10;
        gameContext.moveTo(plateX, top + 20);
        gameContext.lineTo(plateX + 5, top + 4 + Math.abs(2 - plate) * 3);
        gameContext.lineTo(plateX + 10, top + 21);
      }
      gameContext.fill();
      gameContext.fillRect(x + 42, top + 26, 15, 9);
      gameContext.fillRect(x + 1, top + 36, 7, 8 + step);
      gameContext.fillRect(x + 33, top + 36, 7, 8 - step);
    } else {
      gameContext.beginPath();
      gameContext.moveTo(x + 8, top + 26);
      gameContext.lineTo(x - 31, top + 16);
      gameContext.lineTo(x + 13, top + 31);
      gameContext.ellipse(x + 18, top + 25, 20, 10, 0, 0, Math.PI * 2);
      gameContext.fill();
      gameContext.fillRect(x + 28, top + 10, 24, 13);
      gameContext.fillRect(x + 46, top + 19, 13, 4);
      gameContext.beginPath();
      gameContext.moveTo(x + 8, top + 31);
      gameContext.lineTo(x + 1, top + 44 + step);
      gameContext.lineTo(x + 12, top + 44 + step);
      gameContext.lineTo(x + 20, top + 31);
      gameContext.moveTo(x + 25, top + 31);
      gameContext.lineTo(x + 31, top + 44 - step);
      gameContext.lineTo(x + 42, top + 44 - step);
      gameContext.lineTo(x + 34, top + 30);
      gameContext.fill();
    }
    gameContext.fillStyle = gameCloudColor;
    const eyeX = runnerCharacter === 1 ? x + 50 : runnerCharacter === 2 ? x + 51 : x + 46;
    const eyeY = runnerCharacter === 0 ? top + 8 : runnerCharacter === 1 ? top + 24 : runnerCharacter === 2 ? top + 29 : top + 14;
    gameContext.fillRect(eyeX, eyeY, 3, 3);
  }

  function drawObstacle(obstacle) {
    gameContext.fillStyle = "#9bd8ff";
    const top = groundY - obstacle.height;
    if (obstacle.type === "rock") {
      gameContext.beginPath();
      gameContext.moveTo(obstacle.x, groundY);
      gameContext.quadraticCurveTo(obstacle.x + obstacle.width * .35, top, obstacle.x + obstacle.width * .62, top + 4);
      gameContext.quadraticCurveTo(obstacle.x + obstacle.width, top + 7, obstacle.x + obstacle.width, groundY);
      gameContext.fill();
      return;
    }
    if (obstacle.type === "fern") {
      gameContext.fillRect(obstacle.x + obstacle.width * .45, top + 8, 4, obstacle.height - 8);
      gameContext.beginPath();
      gameContext.moveTo(obstacle.x + obstacle.width * .5, top + 13);
      gameContext.lineTo(obstacle.x, top + 3);
      gameContext.lineTo(obstacle.x + obstacle.width * .42, top + 18);
      gameContext.lineTo(obstacle.x + obstacle.width, top + 1);
      gameContext.lineTo(obstacle.x + obstacle.width * .58, top + 19);
      gameContext.fill();
      return;
    }
    if (obstacle.type === "cycad") {
      gameContext.fillRect(obstacle.x + obstacle.width * .44, top + 14, 6, obstacle.height - 14);
      gameContext.beginPath();
      for (let leaf = 0; leaf < 6; leaf += 1) {
        const edge = leaf % 2 ? obstacle.x + obstacle.width : obstacle.x;
        const leafY = top + 2 + Math.floor(leaf / 2) * 7;
        gameContext.moveTo(obstacle.x + obstacle.width * .5, top + 16);
        gameContext.lineTo(edge, leafY);
        gameContext.lineTo(obstacle.x + obstacle.width * .5, top + 21);
      }
      gameContext.fill();
      return;
    }
    if (obstacle.type === "log") {
      gameContext.fillRect(obstacle.x + 4, top + 4, obstacle.width - 8, obstacle.height - 4);
      gameContext.beginPath();
      gameContext.arc(obstacle.x + 5, top + obstacle.height * .58, obstacle.height * .42, 0, Math.PI * 2);
      gameContext.arc(obstacle.x + obstacle.width - 5, top + obstacle.height * .58, obstacle.height * .42, 0, Math.PI * 2);
      gameContext.fill();
      return;
    }
    if (obstacle.type === "stump") {
      gameContext.fillRect(obstacle.x + 5, top + 5, obstacle.width - 10, obstacle.height - 5);
      gameContext.beginPath();
      gameContext.moveTo(obstacle.x, top + 8);
      gameContext.lineTo(obstacle.x + obstacle.width * .4, top);
      gameContext.lineTo(obstacle.x + obstacle.width, top + 6);
      gameContext.lineTo(obstacle.x + obstacle.width * .65, top + 12);
      gameContext.fill();
      return;
    }
    if (obstacle.type === "stones") {
      gameContext.beginPath();
      gameContext.arc(obstacle.x + obstacle.width * .2, groundY - obstacle.height * .38, obstacle.height * .38, Math.PI, Math.PI * 2);
      gameContext.arc(obstacle.x + obstacle.width * .52, groundY - obstacle.height * .55, obstacle.height * .52, Math.PI, Math.PI * 2);
      gameContext.arc(obstacle.x + obstacle.width * .82, groundY - obstacle.height * .3, obstacle.height * .3, Math.PI, Math.PI * 2);
      gameContext.lineTo(obstacle.x + obstacle.width, groundY);
      gameContext.lineTo(obstacle.x, groundY);
      gameContext.fill();
      return;
    }
    gameContext.beginPath();
    gameContext.moveTo(obstacle.x, groundY);
    for (let spike = 0; spike < 5; spike += 1) {
      const baseX = obstacle.x + obstacle.width * spike / 5;
      gameContext.lineTo(baseX + obstacle.width / 10, top + Math.abs(2 - spike) * 4);
      gameContext.lineTo(baseX + obstacle.width / 5, groundY);
    }
    gameContext.fill();
  }

  function overlaps(obstacle) {
    const runnerLeft = runner.x - 12;
    const runnerRight = runner.x + runner.width - 8;
    const runnerTop = runner.y - runner.height + 5;
    return runnerRight > obstacle.x + 3 && runnerLeft < obstacle.x + obstacle.width - 3 && runner.y > groundY - obstacle.height + 4 && runnerTop < groundY;
  }

  function animateGame(now) {
    const elapsed = Math.min(.034, (now - lastGameFrame) / 1000);
    lastGameFrame = now;
    gameContext.clearRect(0, 0, gameWidth, gameHeight);
    gameContext.fillStyle = gameGroundColor;
    gameContext.fillRect(0, groundY, gameWidth, gameHeight - groundY);
    gameContext.strokeStyle = "rgba(155,216,255,.32)";
    gameContext.lineWidth = 2;
    gameContext.beginPath();
    gameContext.moveTo(0, groundY + 1);
    gameContext.lineTo(gameWidth, groundY + 1);
    gameContext.stroke();

    if (gameState === "running") {
      runner.velocity += 1680 * elapsed;
      runner.y += runner.velocity * elapsed;
      if (runner.y >= groundY) {
        runner.y = groundY;
        runner.velocity = 0;
        runner.grounded = true;
      }
      const speed = 285 + Math.min(170, score * .55);
      spawnTimer -= elapsed;
      if (spawnTimer <= 0) spawnObstacle();
      obstacles.forEach((obstacle) => { obstacle.x -= speed * elapsed; });
      obstacles = obstacles.filter((obstacle) => obstacle.x + obstacle.width > -10);
      if (obstacles.some(overlaps)) endGame();
      score += elapsed * 10;
      gameScore.value = String(Math.floor(score)).padStart(5, "0");
    }

    obstacles.forEach(drawObstacle);
    drawRunner(now);
    requestAnimationFrame(animateGame);
  }

  dinoGame.addEventListener("click", playOrJump);
  window.addEventListener("keydown", (event) => {
    if (event.code !== "Space") return;
    const bounds = dinoGame.getBoundingClientRect();
    if (bounds.bottom < 0 || bounds.top > window.innerHeight) return;
    event.preventDefault();
    if (event.repeat) return;
    playOrJump();
  });
  window.addEventListener("resize", resizeGame, { passive: true });
  resizeGame();
  resetGame();
  requestAnimationFrame(animateGame);
}

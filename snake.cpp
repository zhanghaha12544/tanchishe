#include <algorithm>
#include <chrono>
#include <conio.h>
#include <deque>
#include <iostream>
#include <random>
#include <string>
#include <thread>

struct Point {
    int x;
    int y;
};

enum class Direction { Up, Down, Left, Right };

class SnakeGame {
public:
    SnakeGame(int width, int height)
        : width_(width),
          height_(height),
          rng_(std::random_device{}()),
          dist_x_(1, width - 2),
          dist_y_(1, height - 2) {
        reset();
    }

    void run() {
        while (!game_over_) {
            handleInput();
            update();
            render();
            std::this_thread::sleep_for(std::chrono::milliseconds(speed_ms_));
        }
        showGameOver();
    }

private:
    int width_;
    int height_;
    std::deque<Point> snake_;
    Point food_{};
    Direction dir_{Direction::Right};
    Direction next_dir_{Direction::Right};
    bool game_over_{false};
    int score_{0};
    int speed_ms_{130};
    std::mt19937 rng_;
    std::uniform_int_distribution<int> dist_x_;
    std::uniform_int_distribution<int> dist_y_;

    void reset() {
        snake_.clear();
        snake_.push_back({width_ / 2, height_ / 2});
        snake_.push_back({width_ / 2 - 1, height_ / 2});
        snake_.push_back({width_ / 2 - 2, height_ / 2});
        dir_ = Direction::Right;
        next_dir_ = Direction::Right;
        score_ = 0;
        speed_ms_ = 130;
        game_over_ = false;
        spawnFood();
    }

    void handleInput() {
        if (!_kbhit()) {
            return;
        }

        int key = _getch();
        // Arrow keys on Windows emit 224 then actual code.
        if (key == 224) {
            key = _getch();
        }

        switch (key) {
        case 'w':
        case 'W':
        case 72:
            if (dir_ != Direction::Down) {
                next_dir_ = Direction::Up;
            }
            break;
        case 's':
        case 'S':
        case 80:
            if (dir_ != Direction::Up) {
                next_dir_ = Direction::Down;
            }
            break;
        case 'a':
        case 'A':
        case 75:
            if (dir_ != Direction::Right) {
                next_dir_ = Direction::Left;
            }
            break;
        case 'd':
        case 'D':
        case 77:
            if (dir_ != Direction::Left) {
                next_dir_ = Direction::Right;
            }
            break;
        case 'q':
        case 'Q':
            game_over_ = true;
            break;
        default:
            break;
        }
    }

    void update() {
        dir_ = next_dir_;

        Point head = snake_.front();
        switch (dir_) {
        case Direction::Up:
            head.y--;
            break;
        case Direction::Down:
            head.y++;
            break;
        case Direction::Left:
            head.x--;
            break;
        case Direction::Right:
            head.x++;
            break;
        }

        if (hitWall(head) || hitSelf(head)) {
            game_over_ = true;
            return;
        }

        snake_.push_front(head);

        if (head.x == food_.x && head.y == food_.y) {
            score_ += 10;
            if (speed_ms_ > 70) {
                speed_ms_ -= 3;
            }
            spawnFood();
        } else {
            snake_.pop_back();
        }
    }

    bool hitWall(const Point& p) const {
        return p.x <= 0 || p.x >= width_ - 1 || p.y <= 0 || p.y >= height_ - 1;
    }

    bool hitSelf(const Point& p) const {
        return std::any_of(snake_.begin(), snake_.end(), [&p](const Point& b) {
            return b.x == p.x && b.y == p.y;
        });
    }

    void spawnFood() {
        while (true) {
            Point candidate{dist_x_(rng_), dist_y_(rng_)};
            bool in_snake = std::any_of(snake_.begin(), snake_.end(), [&candidate](const Point& b) {
                return b.x == candidate.x && b.y == candidate.y;
            });
            if (!in_snake) {
                food_ = candidate;
                return;
            }
        }
    }

    void render() const {
        system("cls");
        std::cout << "Snake Game (WASD / Arrow keys, Q quit)\n";
        std::cout << "Score: " << score_ << "\n";

        for (int y = 0; y < height_; ++y) {
            for (int x = 0; x < width_; ++x) {
                if (x == 0 || y == 0 || x == width_ - 1 || y == height_ - 1) {
                    std::cout << '#';
                    continue;
                }
                if (x == food_.x && y == food_.y) {
                    std::cout << '*';
                    continue;
                }

                bool printed = false;
                for (size_t i = 0; i < snake_.size(); ++i) {
                    if (snake_[i].x == x && snake_[i].y == y) {
                        std::cout << (i == 0 ? 'O' : 'o');
                        printed = true;
                        break;
                    }
                }
                if (!printed) {
                    std::cout << ' ';
                }
            }
            std::cout << '\n';
        }
    }

    void showGameOver() const {
        system("cls");
        std::cout << "Game Over!\n";
        std::cout << "Final Score: " << score_ << "\n";
        std::cout << "Press any key to exit...\n";
        _getch();
    }
};

int main() {
    // Typical console size target: 40 x 20.
    SnakeGame game(40, 20);
    game.run();
    return 0;
}

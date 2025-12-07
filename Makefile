# Pigs and Farmers - WASM Build

CXX = em++
CXXFLAGS = -std=c++17 -O3 -DNDEBUG -flto
LDFLAGS = --bind -s WASM=1 -s MODULARIZE=1 -s EXPORT_NAME="PigsAndFarmersModule" \
          -s ALLOW_MEMORY_GROWTH=1 -s INITIAL_MEMORY=64MB -s MAXIMUM_MEMORY=256MB \
          -s NO_EXIT_RUNTIME=1 -s ENVIRONMENT='web,worker' \
          -s EXPORTED_RUNTIME_METHODS='["ccall","cwrap"]' \
          -O3 -flto

SRC_DIR = src/cpp
OUT_DIR = public

SOURCES = $(SRC_DIR)/game.cpp $(SRC_DIR)/ai.cpp $(SRC_DIR)/wasm_bindings.cpp
HEADERS = $(SRC_DIR)/game.h $(SRC_DIR)/ai.h

TARGET = $(OUT_DIR)/pigs_and_farmers.js

.PHONY: all clean wasm

all: wasm

wasm: $(TARGET)

$(TARGET): $(SOURCES) $(HEADERS)
	@mkdir -p $(OUT_DIR)
	$(CXX) $(CXXFLAGS) $(SOURCES) $(LDFLAGS) -o $(TARGET)
	@echo "WASM build complete: $(TARGET)"

clean:
	rm -f $(OUT_DIR)/pigs_and_farmers.js $(OUT_DIR)/pigs_and_farmers.wasm

# Development build with debug info
debug:
	@mkdir -p $(OUT_DIR)
	$(CXX) -std=c++17 -O0 -g $(SRC_DIR)/game.cpp $(SRC_DIR)/ai.cpp $(SRC_DIR)/wasm_bindings.cpp \
		--bind -s WASM=1 -s MODULARIZE=1 -s EXPORT_NAME="PigsAndFarmersModule" \
		-s ALLOW_MEMORY_GROWTH=1 -s INITIAL_MEMORY=64MB \
		-s NO_EXIT_RUNTIME=1 -s ENVIRONMENT='web,worker' \
		-s EXPORTED_RUNTIME_METHODS='["ccall","cwrap"]' \
		-s ASSERTIONS=2 -s SAFE_HEAP=1 \
		-o $(TARGET)
	@echo "Debug WASM build complete: $(TARGET)"

/// Persistence abstraction for canvas boards.
///
/// Editor logic depends on this interface only — never on Drift, SQLite,
/// or Supabase directly. Concrete local/cloud backends come later.
abstract class BoardRepository {
  Future<void> save(String boardId, Map<String, dynamic> documentJson);

  Future<Map<String, dynamic>?> load(String boardId);

  Future<void> delete(String boardId);

  Future<List<String>> listBoardIds();
}

/// In-memory repository for development / tests.
class InMemoryBoardRepository implements BoardRepository {
  final Map<String, Map<String, dynamic>> _store = {};

  @override
  Future<void> save(String boardId, Map<String, dynamic> documentJson) async {
    _store[boardId] = Map<String, dynamic>.from(documentJson);
  }

  @override
  Future<Map<String, dynamic>?> load(String boardId) async {
    final value = _store[boardId];
    return value == null ? null : Map<String, dynamic>.from(value);
  }

  @override
  Future<void> delete(String boardId) async {
    _store.remove(boardId);
  }

  @override
  Future<List<String>> listBoardIds() async => _store.keys.toList();
}
